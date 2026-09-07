import type { SearchFilter, SearchParamConfig } from "../fhir/types.ts";
import type { StorageProvider, SqlFilter } from "./types.ts";
import { createDatabase } from "../db.ts";
import { createResourceStore } from "./resource-store.ts";

function getOperator(prefix: string): string {
  switch (prefix) {
    case "eq": return "=";
    case "ne": return "!=";
    case "lt": return "<";
    case "gt": return ">";
    case "le": return "<=";
    case "ge": return ">=";
    case "sa": return ">";
    case "eb": return "<";
    default: return "=";
  }
}

function escapeLikeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function sqliteFilterTranslator(
  filters: SearchFilter[],
  searchParams: Map<string, SearchParamConfig>
): SqlFilter[] {
  const sqlFilters: SqlFilter[] = [];

  for (const filter of filters) {
    const paramConfig = searchParams.get(filter.parameter);
    if (!paramConfig) continue;

    const searchPath = paramConfig.searchPath ?? paramConfig.jsonPath ?? `$.${filter.parameter}`;
    const type = paramConfig.type;

    if (type === "string" || type === "uri") {
      const escaped = escapeLikeValue(filter.value);
      sqlFilters.push({
        column: `json:${searchPath}`,
        op: "LIKE",
        value: `%${escaped}%`,
      });
    } else if (type === "token") {
      if (filter.value.includes("|")) {
        const [system, code] = filter.value.split("|", 2);
        const field = searchPath.includes(".identifier") ? "value" : "code";
        const parts: string[] = [];
        if (system) parts.push(`%"system":"${escapeLikeValue(system)}"%`);
        if (code) parts.push(`%"${field}":"${escapeLikeValue(code)}"%`);
        sqlFilters.push({
          column: `json:${searchPath}`,
          op: "LIKE",
          value: parts.join(`%`),
        });
      } else {
        const isComplexPath = searchPath.includes(".coding") || searchPath.includes(".identifier");
        if (isComplexPath) {
          const field = searchPath.includes(".coding") ? "code" : "value";
          sqlFilters.push({
            column: `json:${searchPath}`,
            op: "LIKE",
            value: `%"${field}":"${escapeLikeValue(filter.value)}"%`,
          });
        } else {
          sqlFilters.push({
            column: `json:${searchPath}`,
            op: "=",
            value: filter.value,
          });
        }
      }
    } else if (type === "date" || type === "number" || type === "quantity") {
      const op = getOperator(filter.prefix ?? "eq");
      sqlFilters.push({
        column: `json:${searchPath}`,
        op,
        value: filter.value,
      });
    } else if (type === "reference") {
      sqlFilters.push({
        column: `json:${searchPath}`,
        op: "=",
        value: filter.value,
      });
    } else {
      sqlFilters.push({
        column: `json:${searchPath}`,
        op: "=",
        value: filter.value,
      });
    }
  }

  return sqlFilters;
}

export function sqliteProvider(dbPath?: string): StorageProvider {
  return {
    createStore() {
      const db = createDatabase(dbPath);
      return createResourceStore(db);
    },
    translateFilters: sqliteFilterTranslator,
  };
}
