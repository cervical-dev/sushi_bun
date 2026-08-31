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

export interface ResourceStore {
  create(resourceType: string, resource: FhirResource): FhirResource;
  read(resourceType: string, id: string): FhirResource | null;
  readVersion(resourceType: string, id: string, versionId: number): FhirResource | null;
  update(resourceType: string, id: string, resource: FhirResource, expectedVersion?: number): FhirResource;
  softDelete(resourceType: string, id: string): boolean;
  listVersions(resourceType: string, id: string): Array<{ versionId: number; lastUpdated: string }>;
  search(resourceType: string, filters: Array<{ column: string; op: string; value: string }>): FhirResource[];
  count(resourceType: string, filters: Array<{ column: string; op: string; value: string }>): number;
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
    `SELECT * FROM resources_history WHERE id = $id AND resource_type = $resource_type ORDER BY version_id`
  );

  const updateStmt = db.prepare(
    `UPDATE resources SET version_id = $version_id, last_updated = $last_updated, data = $data
     WHERE id = $id AND resource_type = $resource_type`
  );

  const softDeleteStmt = db.prepare(
    `UPDATE resources SET is_deleted = 1, last_updated = $last_updated, data = $data
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

  return {
    create(resourceType: string, resource: FhirResource): FhirResource {
      const id = resource.id ?? randomUUID();
      const timestamp = now();

      const data = JSON.stringify({ ...resource, id, resourceType });
      insertStmt.run({ $id: id, $resource_type: resourceType, $last_updated: timestamp, $data: data });
      insertHistoryStmt.run({ $id: id, $resource_type: resourceType, $version_id: 1, $last_updated: timestamp, $data: data });

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
    },

    softDelete(resourceType: string, id: string): boolean {
      const existing = readStmt.get({ $id: id, $resource_type: resourceType }) as ResourceRecord | undefined;
      if (!existing) return false;

      const timestamp = now();
      softDeleteStmt.run({ $id: id, $resource_type: resourceType, $last_updated: timestamp, $data: existing.data });
      return true;
    },

    listVersions(resourceType: string, id: string): Array<{ versionId: number; lastUpdated: string }> {
      return readAllVersionsStmt.all({ $id: id, $resource_type: resourceType }) as Array<{ version_id: number; last_updated: string }>;
    },

    search(resourceType: string, filters: Array<{ column: string; op: string; value: string }>): FhirResource[] {
      let query = `SELECT * FROM resources WHERE resource_type = $resource_type AND is_deleted = 0`;
      const params: Record<string, string> = { $resource_type: resourceType };

      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i]!;
        const paramName = `$p${i}`;
        if (filter.column.startsWith("json:")) {
          const jsonPath = filter.column.slice(5);
          query += ` AND json_extract(data, '${jsonPath}') ${filter.op} ${paramName}`;
        } else {
          query += ` AND ${filter.column} ${filter.op} ${paramName}`;
        }
        params[paramName] = filter.value;
      }

      query += ` ORDER BY last_updated DESC`;

      const stmt = db.prepare(query);
      const records = stmt.all(params) as ResourceRecord[];
      return records.map(toResource);
    },

    count(resourceType: string, filters: Array<{ column: string; op: string; value: string }>): number {
      let query = `SELECT COUNT(*) as cnt FROM resources WHERE resource_type = $resource_type AND is_deleted = 0`;
      const params: Record<string, string> = { $resource_type: resourceType };

      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i]!;
        const paramName = `$p${i}`;
        if (filter.column.startsWith("json:")) {
          const jsonPath = filter.column.slice(5);
          query += ` AND json_extract(data, '${jsonPath}') ${filter.op} ${paramName}`;
        } else {
          query += ` AND ${filter.column} ${filter.op} ${paramName}`;
        }
        params[paramName] = filter.value;
      }

      const stmt = db.prepare(query);
      const result = stmt.get(params) as { cnt: number };
      return result.cnt;
    },
  };
}
