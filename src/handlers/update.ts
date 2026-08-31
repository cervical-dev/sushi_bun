import type { ResourceConfig, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

export async function handleUpdate(req: Request, config: ResourceConfig, store: ResourceStore): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;
  const id = pathParts[1]!;

  if (!config.interactions.has("update")) {
    return createOperationOutcome("error", "not-supported", `Update not supported for ${resourceType}`, 405);
  }

  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/fhir+json") && !contentType.includes("application/json")) {
    return createOperationOutcome("error", "unsupported", "Content-Type must be application/fhir+json", 415);
  }

  let body: FhirResource;
  try {
    body = (await req.json()) as FhirResource;
  } catch {
    return createOperationOutcome("error", "invalid", "Request body is not valid JSON");
  }

  if (body.resourceType !== resourceType) {
    return createOperationOutcome(
      "error",
      "invalid",
      `Resource type in body (${body.resourceType}) does not match URL (${resourceType})`
    );
  }

  if (body.id && body.id !== id) {
    return createOperationOutcome(
      "error",
      "invalid",
      `Resource id in body (${body.id}) does not match URL (${id})`
    );
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

  let resource: FhirResource;
  try {
    resource = store.update(resourceType, id, { ...body, id }, expectedVersion);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "not-found") {
        if (config.updateCreate) {
          resource = store.create(resourceType, { ...body, id });
          return Response.json(resource, {
            status: 201,
            headers: {
              "Content-Type": "application/fhir+json",
              Location: `${resourceType}/${resource.id}/_history/${resource.meta?.versionId}`,
              ETag: `W/"${resource.meta?.versionId}"`,
            },
          });
        }
        return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
      }
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
      Location: `${resourceType}/${resource.id}/_history/${resource.meta?.versionId}`,
      ETag: `W/"${resource.meta?.versionId}"`,
    },
  });
}
