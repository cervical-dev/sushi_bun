import type { ResourceConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

export function handleDelete(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;
  const id = pathParts[1]!;

  if (!config.interactions.has("delete")) {
    return createOperationOutcome("error", "not-supported", `Delete not supported for ${resourceType}`, 405);
  }

  const deleted = store.softDelete(resourceType, id);
  if (!deleted) {
    return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
  }

  const versions = store.listVersions(resourceType, id);
  const versionId = versions.length > 0 ? versions[versions.length - 1]!.version_id : 1;

  return new Response(null, {
    status: 204,
    headers: {
      "Content-Type": "application/fhir+json",
      ETag: `W/"${versionId}"`,
    },
  });
}
