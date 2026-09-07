import type { ResourceConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import { createOperationOutcome } from "./metadata.ts";
import { resolveContext } from "./request-context.ts";

export function handleDelete(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const resolved = resolveContext(req, config, { interaction: "delete", expectId: true });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, id } = resolved.ctx;

  const deleted = store.softDelete(resourceType, id!);
  if (!deleted) {
    if (store.exists(resourceType, id!)) {
      const versions = store.listVersions(resourceType, id!);
      const versionId = versions.length > 0 ? versions[versions.length - 1]!.version_id : 1;
      return new Response(null, {
        status: 204,
        headers: {
          ETag: `W/"${versionId}"`,
        },
      });
    }
    return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
  }

  const versions = store.listVersions(resourceType, id!);
  const versionId = versions.length > 0 ? versions[versions.length - 1]!.version_id : 1;

  return new Response(null, {
    status: 204,
    headers: {
      ETag: `W/"${versionId}"`,
    },
  });
}
