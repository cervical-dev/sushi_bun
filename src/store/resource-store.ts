import { Database } from "bun:sqlite";
import type { FhirResource } from "../fhir/types.ts";
import type { ResourceStore, VersionRecord, TypeHistoryRecord, SqlFilter } from "./types.ts";
import { randomUUID } from "crypto";

interface ResourceRecord {
  id: string;
  resource_type: string;
  version_id: number;
  last_updated: string;
  is_deleted: number;
  data: string;
}

const ALLOWED_OPS = new Set(["=", "!=", "<", ">", "<=", ">=", "LIKE", "NOT LIKE"]);
const ALLOWED_COLUMNS = new Set(["resource_type", "is_deleted", "last_updated", "version_id"]);

function validateOp(op: string): void {
  if (!ALLOWED_OPS.has(op)) {
    throw new Error(`Invalid SQL operator: ${op}`);
  }
}

function validateColumn(column: string): void {
  if (!column.startsWith("json:") && !ALLOWED_COLUMNS.has(column)) {
    throw new Error(`Invalid column: ${column}`);
  }
}

export function createResourceStore(db: Database): ResourceStore {
  const insertStmt = db.prepare(
    `INSERT INTO resources (id, resource_type, version_id, last_updated, data)
     VALUES ($id, $resource_type, 1, $last_updated, $data)`
  );

  const insertHistoryStmt = db.prepare(
    `INSERT INTO resources_history (id, resource_type, version_id, last_updated, data)
     VALUES ($id, $resource_type, $version_id, $last_updated, $data)`
  );

  const readStmt = db.prepare(
    `SELECT * FROM resources WHERE id = $id AND resource_type = $resource_type AND is_deleted = 0`
  );

  const readVersionStmt = db.prepare(
    `SELECT * FROM resources_history WHERE id = $id AND resource_type = $resource_type AND version_id = $version_id`
  );

  const readAllVersionsStmt = db.prepare(
    `SELECT version_id, last_updated FROM resources_history WHERE id = $id AND resource_type = $resource_type ORDER BY version_id`
  );

  const typeHistoryStmt = db.prepare(
    `SELECT * FROM resources_history WHERE resource_type = $resource_type ORDER BY last_updated DESC`
  );

  const typeHistorySinceStmt = db.prepare(
    `SELECT * FROM resources_history WHERE resource_type = $resource_type AND last_updated >= $since ORDER BY last_updated DESC`
  );

  const systemHistoryStmt = db.prepare(
    `SELECT * FROM resources_history ORDER BY last_updated DESC`
  );

  const systemHistorySinceStmt = db.prepare(
    `SELECT * FROM resources_history WHERE last_updated >= $since ORDER BY last_updated DESC`
  );

  const updateStmt = db.prepare(
    `UPDATE resources SET version_id = $version_id, last_updated = $last_updated, data = $data
     WHERE id = $id AND resource_type = $resource_type`
  );

  const softDeleteStmt = db.prepare(
    `UPDATE resources SET is_deleted = 1, version_id = $version_id, last_updated = $last_updated
     WHERE id = $id AND resource_type = $resource_type`
  );

  const checkDeletedStmt = db.prepare(
    `SELECT is_deleted FROM resources WHERE id = $id AND resource_type = $resource_type`
  );

  const currentVersionStmt = db.prepare(
    `SELECT version_id, is_deleted FROM resources WHERE id = $id AND resource_type = $resource_type`
  );

  const undeleteStmt = db.prepare(
    `UPDATE resources SET is_deleted = 0, version_id = 1, last_updated = $last_updated, data = $data
     WHERE id = $id AND resource_type = $resource_type`
  );

  function now(): string {
    return new Date().toISOString();
  }

  function toResource(record: ResourceRecord): FhirResource {
    const parsed = JSON.parse(record.data) as FhirResource;
    parsed.id = record.id;
    parsed.meta = {
      ...parsed.meta,
      versionId: String(record.version_id),
      lastUpdated: record.last_updated,
    };
    return parsed;
  }

  function buildWhereClause(
    resourceType: string,
    filters: SqlFilter[]
  ): { clause: string; params: Record<string, string> } {
    let clause = `resource_type = $resource_type AND is_deleted = 0`;
    const params: Record<string, string> = { $resource_type: resourceType };

    const grouped = new Map<string, SqlFilter[]>();
    for (const filter of filters) {
      const key = filter.column;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(filter);
    }

    let paramIndex = 0;
    for (const [column, groupFilters] of grouped) {
      if (groupFilters.length === 1) {
        const filter = groupFilters[0]!;
        validateOp(filter.op);
        validateColumn(filter.column);
        const paramName = `$p${paramIndex}`;

        if (filter.column.startsWith("json:")) {
          const jsonPath = filter.column.slice(5);
          const pathParam = `$path${paramIndex}`;
          if (filter.op === "LIKE" || filter.op === "NOT LIKE") {
            clause += ` AND (CASE WHEN json_type(data, ${pathParam}) = 'array' THEN EXISTS (SELECT 1 FROM json_each(json_extract(data, ${pathParam})) WHERE json_each.value ${filter.op} ${paramName} ESCAPE '\\') ELSE json_extract(data, ${pathParam}) ${filter.op} ${paramName} ESCAPE '\\' END)`;
          } else {
            clause += ` AND json_extract(data, ${pathParam}) ${filter.op} ${paramName}`;
          }
          params[pathParam] = jsonPath;
        } else {
          clause += ` AND ${filter.column} ${filter.op} ${paramName}`;
        }
        params[paramName] = filter.value;
        paramIndex++;
      } else {
        const orParts: string[] = [];
        for (const filter of groupFilters) {
          validateOp(filter.op);
          validateColumn(filter.column);
          const paramName = `$p${paramIndex}`;

          if (filter.column.startsWith("json:")) {
            const jsonPath = filter.column.slice(5);
            const pathParam = `$path${paramIndex}`;
            if (filter.op === "LIKE" || filter.op === "NOT LIKE") {
              orParts.push(`(CASE WHEN json_type(data, ${pathParam}) = 'array' THEN EXISTS (SELECT 1 FROM json_each(json_extract(data, ${pathParam})) WHERE json_each.value ${filter.op} ${paramName} ESCAPE '\\') ELSE json_extract(data, ${pathParam}) ${filter.op} ${paramName} ESCAPE '\\' END)`);
            } else {
              orParts.push(`json_extract(data, ${pathParam}) ${filter.op} ${paramName}`);
            }
            params[pathParam] = jsonPath;
          } else {
            orParts.push(`${filter.column} ${filter.op} ${paramName}`);
          }
          params[paramName] = filter.value;
          paramIndex++;
        }
        clause += ` AND (${orParts.join(" OR ")})`;
      }
    }

    return { clause, params };
  }

  return {
    create(resourceType: string, resource: FhirResource, forceId?: string): FhirResource {
      const id = forceId ?? randomUUID();
      const timestamp = now();
      const { id: _clientId, meta: clientMeta, ...rest } = resource as any;
      const cleanMeta = { ...(clientMeta ?? {}) };
      delete cleanMeta.versionId;
      delete cleanMeta.lastUpdated;
      const data = JSON.stringify({ ...rest, id, resourceType, ...(Object.keys(cleanMeta).length > 0 ? { meta: cleanMeta } : {}) });

      const runInTx = db.transaction(() => {
        const existing = checkDeletedStmt.get({ $id: id, $resource_type: resourceType }) as { is_deleted: number } | undefined;
        if (existing && existing.is_deleted === 1) {
          undeleteStmt.run({ $id: id, $resource_type: resourceType, $last_updated: timestamp, $data: data });
        } else {
          insertStmt.run({ $id: id, $resource_type: resourceType, $last_updated: timestamp, $data: data });
          insertHistoryStmt.run({ $id: id, $resource_type: resourceType, $version_id: 1, $last_updated: timestamp, $data: data });
        }
      });
      runInTx();

      return { ...rest, id, resourceType, meta: { versionId: "1", lastUpdated: timestamp } };
    },

    read(resourceType: string, id: string): FhirResource | null {
      const record = readStmt.get({ $id: id, $resource_type: resourceType }) as ResourceRecord | undefined;
      return record ? toResource(record) : null;
    },

    readVersion(resourceType: string, id: string, versionId: number): FhirResource | null {
      const record = readVersionStmt.get({ $id: id, $resource_type: resourceType, $version_id: versionId }) as ResourceRecord | undefined;
      return record ? toResource(record) : null;
    },

    update(resourceType: string, id: string, resource: FhirResource, expectedVersion?: number): FhirResource {
      const runInTx = db.transaction(() => {
        const existing = readStmt.get({ $id: id, $resource_type: resourceType }) as ResourceRecord | undefined;
        if (!existing) {
          throw new Error("not-found");
        }

        if (expectedVersion !== undefined && existing.version_id !== expectedVersion) {
          throw new Error("version-conflict");
        }

        const newVersion = existing.version_id + 1;
        const timestamp = now();
        const { id: _clientId, meta: clientMeta, ...rest } = resource as any;
        const cleanMeta = { ...(clientMeta ?? {}) };
        delete cleanMeta.versionId;
        delete cleanMeta.lastUpdated;
        const data = JSON.stringify({ ...rest, id, resourceType, ...(Object.keys(cleanMeta).length > 0 ? { meta: cleanMeta } : {}) });

        updateStmt.run({
          $id: id,
          $resource_type: resourceType,
          $version_id: newVersion,
          $last_updated: timestamp,
          $data: data,
        });

        insertHistoryStmt.run({
          $id: id,
          $resource_type: resourceType,
          $version_id: newVersion,
          $last_updated: timestamp,
          $data: data,
        });

        return { ...rest, id, resourceType, meta: { versionId: String(newVersion), lastUpdated: timestamp } };
      });

      return runInTx();
    },

    softDelete(resourceType: string, id: string): boolean {
      const runInTx = db.transaction(() => {
        const existing = readStmt.get({ $id: id, $resource_type: resourceType }) as ResourceRecord | undefined;
        if (!existing) return false;

        const newVersion = existing.version_id + 1;
        const timestamp = now();

        softDeleteStmt.run({
          $id: id,
          $resource_type: resourceType,
          $version_id: newVersion,
          $last_updated: timestamp,
        });

        insertHistoryStmt.run({
          $id: id,
          $resource_type: resourceType,
          $version_id: newVersion,
          $last_updated: timestamp,
          $data: existing.data,
        });

        return true;
      });

      return runInTx();
    },

    exists(resourceType: string, id: string): boolean {
      const row = checkDeletedStmt.get({ $id: id, $resource_type: resourceType }) as { is_deleted: number } | undefined;
      return row !== undefined && row !== null;
    },

    isDeleted(resourceType: string, id: string): boolean {
      const row = checkDeletedStmt.get({ $id: id, $resource_type: resourceType }) as { is_deleted: number } | undefined;
      return row !== undefined && row !== null && row.is_deleted === 1;
    },

    currentVersion(resourceType: string, id: string): { versionId: number; isDeleted: boolean } | null {
      const row = currentVersionStmt.get({ $id: id, $resource_type: resourceType }) as { version_id: number; is_deleted: number } | undefined;
      if (!row) return null;
      return { versionId: row.version_id, isDeleted: row.is_deleted === 1 };
    },

    listVersions(resourceType: string, id: string): VersionRecord[] {
      return readAllVersionsStmt.all({ $id: id, $resource_type: resourceType }) as VersionRecord[];
    },

    listTypeHistory(resourceType: string, since?: string): TypeHistoryRecord[] {
      if (since) {
        return typeHistorySinceStmt.all({ $resource_type: resourceType, $since: since }) as TypeHistoryRecord[];
      }
      return typeHistoryStmt.all({ $resource_type: resourceType }) as TypeHistoryRecord[];
    },

    listSystemHistory(since?: string): TypeHistoryRecord[] {
      if (since) {
        return systemHistorySinceStmt.all({ $since: since }) as TypeHistoryRecord[];
      }
      return systemHistoryStmt.all() as TypeHistoryRecord[];
    },

    search(resourceType: string, filters: unknown, offset = 0, limit = 20): FhirResource[] {
      const sqlFilters = filters as SqlFilter[];
      const { clause, params } = buildWhereClause(resourceType, sqlFilters);
      const query = `SELECT * FROM resources WHERE ${clause} ORDER BY last_updated DESC LIMIT $limit OFFSET $offset`;

      const stmt = db.prepare(query);
      const records = stmt.all({ ...params, $limit: limit, $offset: offset }) as ResourceRecord[];
      return records.map(toResource);
    },

    count(resourceType: string, filters: unknown): number {
      const sqlFilters = filters as SqlFilter[];
      const { clause, params } = buildWhereClause(resourceType, sqlFilters);
      const query = `SELECT COUNT(*) as cnt FROM resources WHERE ${clause}`;

      const stmt = db.prepare(query);
      const result = stmt.get(params) as { cnt: number };
      return result.cnt;
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}
