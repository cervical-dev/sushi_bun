import type { ResourceConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

export function handleRead(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;
  const id = pathParts[1]!;

  const vidStr = pathParts[3];
  if (vidStr) {
    const versionId = parseInt(vidStr, 10);
    if (isNaN(versionId)) {
      return createOperationOutcome("error", "invalid", "Invalid version id");
    }

    const resource = store.readVersion(resourceType, id, versionId);
    if (!resource) {
      return createOperationOutcome("error", "not-found", `Version ${versionId} of ${resourceType}/${id} not found`, 404);
    }

    const etag = `W/"${resource.meta?.versionId}"`;
    const lastModified = resource.meta?.lastUpdated ?? new Date().toISOString();

    return Response.json(resource, {
      status: 200,
      headers: {
        "Content-Type": "application/fhir+json",
        ETag: etag,
        "Last-Modified": lastModified,
        Location: `${resourceType}/${id}/_history/${resource.meta?.versionId}`,
      },
    });
  }

  if (!config.interactions.has("read")) {
    return createOperationOutcome("error", "not-supported", `Read not supported for ${resourceType}`, 405);
  }

  const resource = store.read(resourceType, id);
  if (!resource) {
    return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
  }

  const etag = `W/"${resource.meta?.versionId}"`;
  const lastModified = resource.meta?.lastUpdated ?? new Date().toISOString();

  return Response.json(resource, {
    status: 200,
    headers: {
      "Content-Type": "application/fhir+json",
      ETag: etag,
      "Last-Modified": lastModified,
    },
  });
}
