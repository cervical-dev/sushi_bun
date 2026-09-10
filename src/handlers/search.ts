import type { ResourceConfig, Bundle, BundleEntry, BundleLink } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import { parseSearchParams, parsePaging } from "../router/params.ts";
import { createOperationOutcome } from "./outcome.ts";
import { resolveContext } from "./request-context.ts";

export function handleSearch(
  req: Request,
  config: ResourceConfig,
  store: ResourceStore
): Response {
  const resolved = resolveContext(req, config, { interaction: "search-type" });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, url } = resolved.ctx;

  const { count, offset } = parsePaging(url.searchParams);

  const searchFilters = parseSearchParams(url.searchParams.toString(), config.searchParams);

  const total = store.count(resourceType, searchFilters, config.searchParams);
  const resources = store.search(resourceType, searchFilters, config.searchParams, offset, count);

  const entries: BundleEntry[] = resources.map((resource) => ({
    fullUrl: `${resourceType}/${resource.id}`,
    resource,
    search: { mode: "match" },
  }));

  const baseUrl = `${url.protocol}//${url.host}`;
  const searchParams = new URLSearchParams(url.searchParams);
  searchParams.delete("_count");
  searchParams.delete("_offset");
  const filterString = searchParams.toString();
  const baseQuery = filterString ? `${filterString}&` : "";

  const links: BundleLink[] = [
    { relation: "self", url: `${baseUrl}/${resourceType}?${url.searchParams.toString()}` },
  ];

  if (offset > 0) {
    links.push({ relation: "first", url: `${baseUrl}/${resourceType}?${baseQuery}_count=${count}&_offset=0` });
    links.push({ relation: "previous", url: `${baseUrl}/${resourceType}?${baseQuery}_count=${count}&_offset=${Math.max(offset - count, 0)}` });
  }

  if (offset + count < total) {
    links.push({ relation: "next", url: `${baseUrl}/${resourceType}?${baseQuery}_count=${count}&_offset=${offset + count}` });
  }

  const bundle: Bundle = {
    resourceType: "Bundle",
    type: "searchset",
    total,
    entry: entries,
    link: links,
  };

  return Response.json(bundle, {
    status: 200,
    headers: { "Content-Type": "application/fhir+json" },
  });
}

export async function handlePostSearch(
  req: Request,
  config: ResourceConfig,
  store: ResourceStore
): Promise<Response> {
  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return createOperationOutcome("error", "unsupported", "Content-Type must be application/x-www-form-urlencoded", 415);
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return createOperationOutcome("error", "invalid", "Could not read request body");
  }

  const url = new URL(req.url);
  const searchParams = new URLSearchParams(body);
  for (const [key, value] of searchParams.entries()) {
    url.searchParams.append(key, value);
  }

  const modifiedReq = new Request(url.toString(), { method: "GET" });
  return handleSearch(modifiedReq, config, store);
}
