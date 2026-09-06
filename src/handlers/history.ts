import type { ResourceConfig, Bundle, BundleEntry, BundleLink } from "../fhir/types.ts";
import type { ResourceStore, TypeHistoryRecord } from "../store/types.ts";
import { createOperationOutcome } from "./metadata.ts";

function buildHistoryBundle(url: URL, entries: BundleEntry[], selfUrl: string): Response {
  const baseUrl = `${url.protocol}//${url.host}`;
  const links: BundleLink[] = [{ relation: "self", url: `${baseUrl}${selfUrl}` }];

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

function historyRecordToEntry(v: TypeHistoryRecord): BundleEntry {
  const resource = JSON.parse(v.data);
  resource.id = v.id;
  resource.meta = { ...resource.meta, versionId: String(v.version_id), lastUpdated: v.last_updated };
  return {
    fullUrl: `${v.resource_type}/${v.id}/_history/${v.version_id}`,
    resource,
    request: {
      method: "GET",
      url: `${v.resource_type}/${v.id}/_history/${v.version_id}`,
    },
    response: {
      status: "200",
      lastModified: v.last_updated,
      etag: `W/"${v.version_id}"`,
    },
  };
}

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

  return buildHistoryBundle(url, entries, `/${resourceType}/${id}/_history`);
}

export function handleTypeHistory(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;
  const since = url.searchParams.get("_since") ?? undefined;

  if (!config.interactions.has("history-type")) {
    return createOperationOutcome("error", "not-supported", `Type history not supported for ${resourceType}`, 405);
  }

  const records = store.listTypeHistory(resourceType, since);
  const entries = records.map(historyRecordToEntry);
  return buildHistoryBundle(url, entries, `/${resourceType}/_history`);
}

export function handleSystemHistory(req: Request, store: ResourceStore): Response {
  const url = new URL(req.url);
  const since = url.searchParams.get("_since") ?? undefined;

  const records = store.listSystemHistory(since);
  const entries = records.map(historyRecordToEntry);
  return buildHistoryBundle(url, entries, `/_history`);
}
