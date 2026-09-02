import type { SearchFilter } from "../fhir/types.ts";
import type { StorageProvider, SqlFilter } from "./types.ts";
import { createDatabase } from "../db.ts";
import { createResourceStore } from "./resource-store.ts";

function getSqlForParam(paramName: string, _type: string): { column: string; useLike: boolean } {
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

export function sqliteFilterTranslator(
  filters: SearchFilter[],
  searchParams: Map<string, { name: string; type: string }>
): SqlFilter[] {
  const sqlFilters: SqlFilter[] = [];

  for (const filter of filters) {
    const paramConfig = searchParams.get(filter.parameter);
    if (!paramConfig) continue;

    const sqlInfo = getSqlForParam(filter.parameter, paramConfig.type);
    const op = sqlInfo.useLike ? "LIKE" : getOperator(filter.prefix ?? "eq");
    const sqlValue = sqlInfo.useLike
      ? `%${filter.value}%`
      : filter.value;

    sqlFilters.push({
      column: sqlInfo.column,
      op,
      value: sqlValue,
    });
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
