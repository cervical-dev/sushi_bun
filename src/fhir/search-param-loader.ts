import { resolveSearchParamMapping, type SearchParameterResource } from "./search-param-resolver.ts";
import type { RouteConfig } from "./types.ts";

export async function loadSearchParameters(sdDir: string): Promise<SearchParameterResource[]> {
  const params: SearchParameterResource[] = [];
  try {
    const entries = await Array.fromAsync(
      new Bun.Glob("SearchParameter-*.json").scan({ cwd: sdDir })
    );
    for (const entry of entries) {
      const file = Bun.file(`${sdDir}/${entry}`);
      const sp = (await file.json()) as SearchParameterResource;
      if (sp.resourceType === "SearchParameter" && sp.code) {
        params.push(sp);
      }
    }
  } catch {
    // No SearchParameter resources found — not an error
  }
  return params;
}

export function applyResolvedMapping(config: RouteConfig, searchParameters: SearchParameterResource[]): void {
  for (const [, resourceConfig] of config.resources) {
    const mapping = resolveSearchParamMapping(resourceConfig.searchParams, searchParameters);
    for (const [name, resolved] of mapping) {
      const param = resourceConfig.searchParams.get(name);
      if (param) {
        param.jsonPath = resolved.jsonPath;
        param.searchPath = resolved.searchPath;
      }
    }
  }
}
