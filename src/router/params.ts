import type { SearchFilter } from "../fhir/types.ts";

export function parseSearchParams(
  queryString: string,
  searchParams: Map<string, { name: string; type: string }>
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

    const parsed = parseValue(value, paramConfig.type);

    filters.push({
      parameter: param,
      prefix: parsed.prefix,
      value: parsed.value,
      modifier,
    });
  }

  return filters;
}

function parseValue(value: string, type: string): { prefix?: string; value: string } {
  if (type === "string" || type === "uri") {
    return { value };
  }

  if (type === "token") {
    return { value };
  }

  if (type === "date" || type === "number" || type === "quantity") {
    const prefixMatch = value.match(/^(eq|ne|lt|gt|le|ge|sa|eb)(.+)$/);
    if (prefixMatch) {
      return { prefix: prefixMatch[1], value: prefixMatch[2]! };
    }
    return { prefix: "eq", value };
  }

  if (type === "reference") {
    return { value };
  }

  return { value };
}

export function filtersToSqlFilters(
  filters: SearchFilter[],
  searchParams: Map<string, { name: string; type: string }>
): Array<{ column: string; op: string; value: string }> {
  const sqlFilters: Array<{ column: string; op: string; value: string }> = [];

  for (const filter of filters) {
    const paramConfig = searchParams.get(filter.parameter);
    if (!paramConfig) continue;

    const sqlInfo = getSqlForParam(filter.parameter, paramConfig.type);
    const op = sqlInfo.useLike ? "LIKE" : getOperator(filter.prefix ?? "eq");
    const sqlValue = sqlInfo.useLike
      ? `%${filter.value}%`
      : formatSqlValue(filter.value, paramConfig.type, filter.prefix ?? "eq");

    sqlFilters.push({
      column: sqlInfo.column,
      op,
      value: sqlValue,
    });
  }

  return sqlFilters;
}

interface SqlInfo {
  column: string;
  useLike: boolean;
}

function getSqlForParam(paramName: string, _type: string): SqlInfo {
  switch (paramName) {
    case "name":
    case "family":
      return { column: "json:$.name", useLike: true };
    case "given":
      return { column: "json:$.name", useLike: true };
    case "gender":
      return { column: "json:$.gender", useLike: false };
    case "birthdate":
      return { column: "json:$.birthDate", useLike: false };
    case "identifier":
      return { column: "json:$.identifier", useLike: true };
    case "patient":
    case "subject":
      return { column: "json:$.subject.reference", useLike: false };
    case "code":
      return { column: "json:$.code", useLike: true };
    case "status":
      return { column: "json:$.status", useLike: false };
    default:
      return { column: `json:$.${paramName}`, useLike: true };
  }
}

function getOperator(prefix: string): string {
  switch (prefix) {
    case "eq": return "=";
    case "ne": return "!=";
    case "lt": return "<";
    case "gt": return ">";
    case "le": return "<=";
    case "ge": return ">=";
    default: return "=";
  }
}

function formatSqlValue(value: string, _type: string, prefix: string): string {
  return value;
}
