import type { ResourceConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import { createOperationOutcome } from "./metadata.ts";
import { resolveContext } from "./request-context.ts";

export function handleRead(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const probeUrl = new URL(req.url);
  const probeParts = probeUrl.pathname.split("/").filter(Boolean);
  const isVread = probeParts.length >= 4 && probeParts[2] === "_history";

  if (isVread) {
    const resolved = resolveContext(req, config, {
      interaction: "history-instance",
      expectId: true,
      expectVid: true,
    });
    if (!resolved.ok) return resolved.outcome;
    const { resourceType, id, vid, baseUrl } = resolved.ctx;
    const versionId = vid!;

    const resource = store.readVersion(resourceType, id!, versionId);
    if (!resource) {
      return createOperationOutcome("error", "not-found", `Version ${versionId} of ${resourceType}/${id} not found`, 404);
    }

    const current = store.currentVersion(resourceType, id!);
    if (current && current.isDeleted && current.versionId === versionId) {
      const etag = `W/"${versionId}"`;
      return createOperationOutcome("error", "deleted", `${resourceType}/${id} is deleted`, 410, etag);
    }

    const etag = `W/"${resource.meta?.versionId}"`;
    const lastModified = resource.meta?.lastUpdated ?? new Date().toISOString();

    return Response.json(resource, {
      status: 200,
      headers: {
        "Content-Type": "application/fhir+json",
        ETag: etag,
        "Last-Modified": lastModified,
        Location: `${baseUrl}/${resourceType}/${id}/_history/${resource.meta?.versionId}`,
      },
    });
  }

  const resolved = resolveContext(req, config, { interaction: "read", expectId: true });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, id } = resolved.ctx;

  const resource = store.read(resourceType, id!);
  if (!resource) {
    if (store.isDeleted(resourceType, id!)) {
      const versions = store.listVersions(resourceType, id!);
      const latestVersion = versions.length > 0 ? versions[versions.length - 1]!.version_id : 1;
      const etag = `W/"${latestVersion}"`;
      return createOperationOutcome("error", "deleted", `${resourceType}/${id} is deleted`, 410, etag);
    }
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
