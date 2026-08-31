import { Database } from "bun:sqlite";
import type { FhirResource } from "../fhir/types.ts";
import { randomUUID } from "crypto";

export interface ResourceRecord {
  id: string;
  resource_type: string;
  version_id: number;
  last_updated: string;
  is_deleted: number;
  data: string;
}

export interface VersionRecord {
  version_id: number;
  last_updated: string;
  data: string;
}

export interface ResourceStore {
  create(resourceType: string, resource: FhirResource): FhirResource;
  read(resourceType: string, id: string): FhirResource | null;
  readVersion(resourceType: string, id: string, versionId: number): FhirResource | null;
  update(resourceType: string, id: string, resource: FhirResource, expectedVersion?: number): FhirResource;
  softDelete(resourceType: string, id: string): boolean;
  listVersions(resourceType: string, id: string): VersionRecord[];
  search(resourceType: string, filters: Array<{ column: string; op: string; value: string }>, offset?: number, limit?: number): FhirResource[];
  count(resourceType: string, filters: Array<{ column: string; op: string; value: string }>): number;
  transaction<T>(fn: () => T): T;
}

const ALLOWED_OPS = new Set(["=", "!=", "<", ">", "<=", ">=", "LIKE", "NOT LIKE"]);

function validateOp(op: string): void {
  if (!ALLOWED_OPS.has(op)) {
    throw new Error(`Invalid SQL operator: ${op}`);
  }
}

const JSON_PATHS: Record<string, string> = {
  name: "$.name",
  family: "$.name",
  given: "$.name",
  gender: "$.gender",
  birthdate: "$.birthDate",
  identifier: "$.identifier",
  patient: "$.subject.reference",
  subject: "$.subject.reference",
  code: "$.code",
  status: "$.status",
};

function getJsonPath(paramName: string): string {
  return JSON_PATHS[paramName] ?? `$.${paramName}`;
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

  const updateStmt = db.prepare(
    `UPDATE resources SET version_id = $version_id, last_updated = $last_updated, data = $data
     WHERE id = $id AND resource_type = $resource_type`
  );

  const softDeleteStmt = db.prepare(
    `UPDATE resources SET is_deleted = 1, version_id = $version_id, last_updated = $last_updated
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
    filters: Array<{ column: string; op: string; value: string }>
  ): { clause: string; params: Record<string, string> } {
    let clause = `resource_type = $resource_type AND is_deleted = 0`;
    const params: Record<string, string> = { $resource_type: resourceType };

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i]!;
      validateOp(filter.op);
      const paramName = `$p${i}`;

      if (filter.column.startsWith("json:")) {
        const jsonPath = filter.column.slice(5);
        clause += ` AND json_extract(data, $${`path${i}`}) ${filter.op} ${paramName}`;
        params[`$path${i}`] = jsonPath;
      } else {
        clause += ` AND ${filter.column} ${filter.op} ${paramName}`;
      }
      params[paramName] = filter.value;
    }

    return { clause, params };
  }

  return {
    create(resourceType: string, resource: FhirResource): FhirResource {
      const id = resource.id ?? randomUUID();
      const timestamp = now();
      const data = JSON.stringify({ ...resource, id, resourceType });

      const runInTx = db.transaction(() => {
        insertStmt.run({ $id: id, $resource_type: resourceType, $last_updated: timestamp, $data: data });
        insertHistoryStmt.run({ $id: id, $resource_type: resourceType, $version_id: 1, $last_updated: timestamp, $data: data });
      });
      runInTx();

      return { ...resource, id, resourceType, meta: { versionId: "1", lastUpdated: timestamp } };
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
        const data = JSON.stringify({ ...resource, id, resourceType });

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

        return { ...resource, id, resourceType, meta: { versionId: String(newVersion), lastUpdated: timestamp } };
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

    listVersions(resourceType: string, id: string): VersionRecord[] {
      return readAllVersionsStmt.all({ $id: id, $resource_type: resourceType }) as VersionRecord[];
    },

    search(resourceType: string, filters: Array<{ column: string; op: string; value: string }>, offset = 0, limit = 20): FhirResource[] {
      const { clause, params } = buildWhereClause(resourceType, filters);
      const query = `SELECT * FROM resources WHERE ${clause} ORDER BY last_updated DESC LIMIT $limit OFFSET $offset`;

      const stmt = db.prepare(query);
      const records = stmt.all({ ...params, $limit: limit, $offset: offset }) as ResourceRecord[];
      return records.map(toResource);
    },

    count(resourceType: string, filters: Array<{ column: string; op: string; value: string }>): number {
      const { clause, params } = buildWhereClause(resourceType, filters);
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
