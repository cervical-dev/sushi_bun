import type { ResourceConfig, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

export async function handleCreate(req: Request, config: ResourceConfig, store: ResourceStore): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;
  const baseUrl = `${url.protocol}//${url.host}`;

  if (!config.interactions.has("create")) {
    return createOperationOutcome("error", "not-supported", `Create not supported for ${resourceType}`, 405);
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

  const resource = store.create(resourceType, body);

  return Response.json(resource, {
    status: 201,
    headers: {
      "Content-Type": "application/fhir+json",
      Location: `${baseUrl}/${resourceType}/${resource.id}/_history/${resource.meta?.versionId}`,
      ETag: `W/"${resource.meta?.versionId}"`,
      "Last-Modified": resource.meta?.lastUpdated ?? new Date().toISOString(),
    },
  });
}
