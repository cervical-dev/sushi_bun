import type { ResourceConfig, Bundle, BundleEntry, BundleLink, FhirResource, SearchFilter } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { parseSearchParams, filtersToSqlFilters } from "../router/params.ts";

export function handleSearch(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;

  const countParam = url.searchParams.get("_count");
  const offsetParam = url.searchParams.get("_offset");
  const count = countParam ? Math.min(parseInt(countParam, 10) || 20, 100) : 20;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

  const searchFilters = parseSearchParams(url.searchParams.toString(), config.searchParams);
  const sqlFilters = filtersToSqlFilters(searchFilters, config.searchParams);

  const total = store.count(resourceType, sqlFilters);
  const resources = store.search(resourceType, sqlFilters);

  const paginatedResources = resources.slice(offset, offset + count);

  const entries: BundleEntry[] = paginatedResources.map((resource) => ({
    fullUrl: `${resourceType}/${resource.id}`,
    resource,
    search: { mode: "match" },
  }));

  const baseUrl = `${url.protocol}//${url.host}`;
  const selfUrl = `${baseUrl}/${resourceType}?${url.searchParams.toString()}`;

  const links: BundleLink[] = [{ relation: "self", url: selfUrl }];

  if (offset > 0) {
    links.push({
      relation: "first",
      url: `${baseUrl}/${resourceType}?_count=${count}&_offset=0`,
    });
  }

  if (offset + count < total) {
    links.push({
      relation: "next",
      url: `${baseUrl}/${resourceType}?_count=${count}&_offset=${offset + count}`,
    });
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
    headers: {
      "Content-Type": "application/fhir+json",
    },
  });
}
