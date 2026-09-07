import type { ResourceConfig, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { validateResource } from "../fhir/validator.ts";
import { getProfileUrl } from "../fhir/types.ts";
import { createOperationOutcome, createOperationOutcomeFromIssues } from "./metadata.ts";
import { applyPatch, PatchError, type PatchOp } from "../fhir/patch.ts";
import { resolveContext, parseAndValidateBody, respondWithResource } from "./request-context.ts";

export async function handlePatch(
  req: Request,
  config: ResourceConfig,
  store: ResourceStore,
  validators?: ValidatorRegistry
): Promise<Response> {
  const resolved = resolveContext(req, config, { interaction: "patch", expectId: true });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, id, baseUrl } = resolved.ctx;
  const resourceId = id!;

  const parsed = await parseAndValidateBody(req, resolved.ctx, undefined, {
    contentTypes: ["application/json-patch+json"],
    validateAs: "patch-ops",
    parseIfMatch: true,
  });
  if (!parsed.ok) return parsed.outcome;
  const ops = parsed.body as PatchOp[];
  const expectedVersion = parsed.expectedVersion;

  const existing = store.read(resourceType, resourceId);
  if (!existing) {
    if (store.isDeleted(resourceType, resourceId)) {
      const versions = store.listVersions(resourceType, resourceId);
      const latestVersion = versions.length > 0 ? versions[versions.length - 1]!.version_id : 1;
      return createOperationOutcome("error", "deleted", `${resourceType}/${resourceId} is deleted`, 410, `W/"${latestVersion}"`);
    }
    return createOperationOutcome("error", "not-found", `${resourceType}/${resourceId} not found`, 404);
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
    resource = store.update(resourceType, resourceId, { ...patched, id: resourceId } as FhirResource, expectedVersion);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "version-conflict") {
        return createOperationOutcome("error", "conflict", "Version mismatch. Use correct If-Match header.", 412);
      }
    }
    return createOperationOutcome("error", "exception", "Internal server error", 500);
  }

  return respondWithResource(resource, baseUrl, 200);
}
