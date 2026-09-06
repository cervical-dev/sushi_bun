import type { ResourceConfig, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { validateResource } from "../fhir/validator.ts";
import { getProfileUrl } from "../fhir/types.ts";
import { createOperationOutcome, createOperationOutcomeFromIssues } from "./metadata.ts";
import { applyPatch, PatchError, type PatchOp } from "../fhir/patch.ts";

export async function handlePatch(
  req: Request,
  config: ResourceConfig,
  store: ResourceStore,
  validators?: ValidatorRegistry
): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;
  const id = pathParts[1]!;
  const baseUrl = `${url.protocol}//${url.host}`;

  if (!config.interactions.has("patch")) {
    return createOperationOutcome("error", "not-supported", `Patch not supported for ${resourceType}`, 405);
  }

  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json-patch+json")) {
    return createOperationOutcome("error", "unsupported", "Content-Type must be application/json-patch+json", 415);
  }

  let ops: PatchOp[];
  try {
    ops = (await req.json()) as PatchOp[];
  } catch {
    return createOperationOutcome("error", "invalid", "Request body is not valid JSON");
  }

  if (!Array.isArray(ops) || ops.length === 0) {
    return createOperationOutcome("error", "invalid", "PATCH body must be a non-empty array of operations");
  }

  const existing = store.read(resourceType, id);
  if (!existing) {
    if (store.isDeleted(resourceType, id)) {
      const versions = store.listVersions(resourceType, id);
      const latestVersion = versions.length > 0 ? versions[versions.length - 1]!.version_id : 1;
      return createOperationOutcome("error", "deleted", `${resourceType}/${id} is deleted`, 410, `W/"${latestVersion}"`);
    }
    return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
  }

  let expectedVersion: number | undefined;
  const ifMatch = req.headers.get("If-Match");
  if (ifMatch) {
    const versionMatch = ifMatch.match(/^W?\/?"(\d+)"$/);
    if (!versionMatch) {
      return createOperationOutcome("error", "invalid", "If-Match header must be a weak ETag with version id");
    }
    expectedVersion = parseInt(versionMatch[1]!, 10);
  }

  let patched: Record<string, unknown>;
  try {
    patched = applyPatch(existing as Record<string, unknown>, ops);
  } catch (err) {
    if (err instanceof PatchError) {
      if (err.message.includes("test failed")) {
        return createOperationOutcome("error", "precondition-failed", "Patch test operation failed", 422);
      }
      return createOperationOutcome("error", "invalid", err.message, 422);
    }
    return createOperationOutcome("error", "invalid", err instanceof Error ? err.message : "Invalid patch operation", 422);
  }

  if ((patched as FhirResource).resourceType !== resourceType) {
    return createOperationOutcome("error", "invalid", "PATCH cannot change resourceType");
  }

  if (validators) {
    const profileUrl = getProfileUrl(patched);
    const sd = validators.getValidator(resourceType, profileUrl);
    if (sd) {
      const validation = validateResource(patched, sd);
      if (!validation.valid) {
        return createOperationOutcomeFromIssues(validation.issues, 422);
      }
    }
  }

  let resource: FhirResource;
  try {
    resource = store.update(resourceType, id, { ...patched, id } as FhirResource, expectedVersion);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "version-conflict") {
        return createOperationOutcome("error", "conflict", "Version mismatch. Use correct If-Match header.", 412);
      }
    }
    return createOperationOutcome("error", "exception", "Internal server error", 500);
  }

  return Response.json(resource, {
    status: 200,
    headers: {
      "Content-Type": "application/fhir+json",
      Location: `${baseUrl}/${resourceType}/${resource.id}/_history/${resource.meta?.versionId}`,
      ETag: `W/"${resource.meta?.versionId}"`,
      "Last-Modified": resource.meta?.lastUpdated ?? new Date().toISOString(),
    },
  });
}
