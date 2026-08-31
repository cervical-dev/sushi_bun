import type { ResourceConfig, Bundle, BundleEntry, BundleLink } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

export function handleHistory(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;
  const id = pathParts[1]!;

  if (!config.interactions.has("history-instance")) {
    return createOperationOutcome("error", "not-supported", `History not supported for ${resourceType}`, 405);
  }

  const versions = store.listVersions(resourceType, id);
  if (versions.length === 0) {
    return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
  }

  const entries: BundleEntry[] = versions.map((v) => {
    const resource = store.readVersion(resourceType, id, v.version_id);
    return {
      fullUrl: `${resourceType}/${id}/_history/${v.version_id}`,
      resource: resource ?? undefined,
      request: {
        method: "GET",
        url: `${resourceType}/${id}/_history/${v.version_id}`,
      },
      response: {
        status: "200",
        lastModified: v.last_updated,
        etag: `W/"${v.version_id}"`,
      },
    };
  });

  const baseUrl = `${url.protocol}//${url.host}`;
  const links: BundleLink[] = [{ relation: "self", url: `${baseUrl}/${resourceType}/${id}/_history` }];

  const bundle: Bundle = {
    resourceType: "Bundle",
    type: "history",
    total: entries.length,
    entry: entries,
    link: links,
  };

  return Response.json(bundle, {
    status: 200,
    headers: { "Content-Type": "application/fhir+json" },
  });
}
