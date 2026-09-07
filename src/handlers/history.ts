import type { ResourceConfig, Bundle, BundleEntry, BundleLink } from "../fhir/types.ts";
import type { ResourceStore, TypeHistoryRecord } from "../store/types.ts";
import { createOperationOutcome } from "./outcome.ts";
import { resolveContext, historyEntry } from "./request-context.ts";

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
  return historyEntry({
    resourceType: v.resource_type,
    id: v.id,
    versionId: v.version_id,
    lastUpdated: v.last_updated,
    resource,
  });
}

export function handleHistory(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const resolved = resolveContext(req, config, { interaction: "history-instance", expectId: true });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, id, url } = resolved.ctx;

  const versions = store.listVersions(resourceType, id!);
  if (versions.length === 0) {
    return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
  }

  const entries: BundleEntry[] = versions.map((v) =>
    historyEntry({
      resourceType,
      id: id!,
      versionId: v.version_id,
      lastUpdated: v.last_updated,
      resource: store.readVersion(resourceType, id!, v.version_id) ?? undefined,
    })
  );

  return buildHistoryBundle(url, entries, `/${resourceType}/${id}/_history`);
}

export function handleTypeHistory(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const resolved = resolveContext(req, config, { interaction: "history-type" });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, url } = resolved.ctx;
  const since = url.searchParams.get("_since") ?? undefined;

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
