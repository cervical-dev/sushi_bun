import type { SearchFilter, SearchParamConfig } from "../fhir/types.ts";

export function parseSearchParams(
  queryString: string,
  searchParams: Map<string, SearchParamConfig>
): SearchFilter[] {
  const filters: SearchFilter[] = [];
  const params = new URLSearchParams(queryString);

  for (const [key, value] of params.entries()) {
    if (key.startsWith("_")) continue;

    let param = key;
    let modifier: string | undefined;

    const colonIndex = key.indexOf(":");
    if (colonIndex !== -1) {
      param = key.slice(0, colonIndex);
      modifier = key.slice(colonIndex + 1);
    }

    const paramConfig = searchParams.get(param);
    if (!paramConfig) continue;

    const parsedValues = parseValue(value, paramConfig.type);

    for (const parsed of parsedValues) {
      filters.push({
        parameter: param,
        prefix: parsed.prefix,
        value: parsed.value,
        modifier,
      });
    }
  }

  return filters;
}

function parseValue(value: string, type: string): Array<{ prefix?: string; value: string }> {
  if (type === "string" || type === "uri") {
    if (value.includes(",")) {
      return value.split(",").map(v => ({ value: v.trim() }));
    }
    return [{ value }];
  }

  if (type === "token") {
    if (value.includes(",")) {
      return value.split(",").map(v => ({ value: v.trim() }));
    }
    return [{ value }];
  }

  if (type === "date" || type === "number" || type === "quantity") {
    const prefixMatch = value.match(/^(eq|ne|lt|gt|le|ge|sa|eb)(.+)$/);
    if (prefixMatch) {
      return [{ prefix: prefixMatch[1], value: prefixMatch[2]! }];
    }
    return [{ prefix: "eq", value }];
  }

  if (type === "reference") {
    if (value.includes(",")) {
      return value.split(",").map(v => ({ value: v.trim() }));
    }
    return [{ value }];
  }

  return [{ value }];
}
