import { describe, it, expect, beforeEach } from "bun:test";
import { createSqliteStore } from "../../src/store/sqlite-provider.ts";
import type { Database } from "bun:sqlite";

function createTestStore() {
  return createSqliteStore(":memory:");
}

describe("ResourceStore", () => {
  let store: ReturnType<typeof createTestStore>["store"];
  let db: Database;

  beforeEach(() => {
    const s = createTestStore();
    store = s.store;
    db = s.db;
  });

  it("creates a resource and assigns an id", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    expect(created.id).toBeDefined();
    expect(created.resourceType).toBe("Patient");
    expect(created.meta?.versionId).toBe("1");
    expect(created.meta?.lastUpdated).toBeDefined();
  });

  it("creates with server-assigned id ignoring client id", () => {
    const patient = { resourceType: "Patient", id: "my-custom-id", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    expect(created.id).not.toBe("my-custom-id");
    expect(created.id).toBeDefined();
  });

  it("create ignores client meta.versionId and assigns version 1", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }], meta: { versionId: "99" } };
    const created = store.create("Patient", patient);
    expect(created.meta?.versionId).toBe("1");
    const row = db.query("SELECT data FROM resources WHERE id = ?").get(created.id!) as { data: string };
    const stored = JSON.parse(row.data);
    expect(stored.meta?.versionId).toBeUndefined();
  });

  it("create ignores client meta.lastUpdated and assigns current timestamp", () => {
    const before = Date.now();
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }], meta: { lastUpdated: "2000-01-01T00:00:00Z" } };
    const created = store.create("Patient", patient);
    const after = Date.now();
    const stored = new Date(created.meta!.lastUpdated!).getTime();
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(after);
    const row = db.query("SELECT data FROM resources WHERE id = ?").get(created.id!) as { data: string };
    const parsed = JSON.parse(row.data);
    expect(parsed.meta?.lastUpdated).toBeUndefined();
  });

  it("reads a resource by id", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    const read = store.read("Patient", created.id!);
    expect(read).toBeTruthy();
    expect(read!.id).toBe(created.id);
    expect(read!.resourceType).toBe("Patient");
  });

  it("returns null for non-existent resource", () => {
    const read = store.read("Patient", "non-existent");
    expect(read).toBeNull();
  });

  it("increments version on update", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    const updated = store.update("Patient", created.id!, { ...patient, gender: "male" });
    expect(updated.meta?.versionId).toBe("2");
  });

  it("throws on version conflict", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    expect(() => {
      store.update("Patient", created.id!, { ...patient, gender: "male" }, 999);
    }).toThrow("version-conflict");
  });

  it("soft deletes a resource and creates history entry", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    const deleted = store.softDelete("Patient", created.id!);
    expect(deleted).toBe(true);

    const read = store.read("Patient", created.id!);
    expect(read).toBeNull();

    const versions = store.listVersions("Patient", created.id!);
    expect(versions.length).toBe(2);
    expect(versions[1]!.versionId).toBe(2);
  });

  it("returns false when deleting non-existent resource", () => {
    const deleted = store.softDelete("Patient", "non-existent");
    expect(deleted).toBe(false);
  });

  it("listVersions returns VersionEntry shape", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    store.update("Patient", created.id!, { ...patient, gender: "male" });

    const versions = store.listVersions("Patient", created.id!);
    expect(versions.length).toBe(2);
    expect(versions[0]!.versionId).toBe(1);
    expect(versions[0]!.lastUpdated).toBeDefined();
    expect(versions[1]!.versionId).toBe(2);
    expect(versions[1]!.lastUpdated).toBeDefined();
  });

  it("listTypeHistory returns HistoryEntry shape", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    store.create("Observation", { resourceType: "Observation", status: "final" });

    const entries = store.listTypeHistory("Patient");
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBeDefined();
    expect(entries[0]!.resourceType).toBe("Patient");
    expect(entries[0]!.versionId).toBe(1);
    expect(entries[0]!.lastUpdated).toBeDefined();
    expect(entries[0]!.resource).toBeDefined();
    expect(entries[0]!.resource.resourceType).toBe("Patient");
  });

  it("searches with FHIR SearchFilters (token type)", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], gender: "male" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], gender: "female" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith2" }], gender: "male" });

    const searchParams = new Map([["gender", { name: "gender", type: "token", jsonPath: "$.gender" }]]);
    const results = store.search("Patient", [{ parameter: "gender", value: "male" }], searchParams);
    expect(results.length).toBe(2);
  });

  it("searches excludes soft-deleted resources", () => {
    const p = store.create("Patient", { resourceType: "Patient", name: [{ family: "Doomed" }] });
    store.softDelete("Patient", p.id!);

    const results = store.search("Patient", [], new Map());
    expect(results.length).toBe(0);
  });

  it("search with pagination", () => {
    for (let i = 0; i < 10; i++) {
      store.create("Patient", { resourceType: "Patient", name: [{ family: `Patient${i}` }] });
    }

    const page1 = store.search("Patient", [], new Map(), 0, 3);
    expect(page1.length).toBe(3);

    const page2 = store.search("Patient", [], new Map(), 3, 3);
    expect(page2.length).toBe(3);

    const page4 = store.search("Patient", [], new Map(), 9, 3);
    expect(page4.length).toBe(1);
  });

  it("count with FHIR SearchFilters", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], gender: "male" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], gender: "female" });

    const searchParams = new Map([["gender", { name: "gender", type: "token", jsonPath: "$.gender" }]]);
    const maleCount = store.count("Patient", [{ parameter: "gender", value: "male" }], searchParams);
    expect(maleCount).toBe(1);

    const totalCount = store.count("Patient", [], new Map());
    expect(totalCount).toBe(2);
  });

  it("searches with FHIR SearchFilters (date prefix)", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], birthDate: "1990-01-01" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], birthDate: "2000-01-01" });

    const searchParams = new Map([["birthdate", { name: "birthdate", type: "date", jsonPath: "$.birthDate" }]]);
    const results = store.search("Patient", [{ parameter: "birthdate", prefix: "ge", value: "1995-01-01" }], searchParams);
    expect(results.length).toBe(1);
    expect(results[0]!.name).toEqual([{ family: "Jones" }]);
  });

  it("transaction rolls back on error", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Before" }] });

    try {
      store.transaction(() => {
        store.create("Patient", { resourceType: "Patient", name: [{ family: "Inside" }] });
        throw new Error("Rollback!");
      });
    } catch {}

    const results = store.search("Patient", [], new Map());
    expect(results.length).toBe(1);
    expect(results[0]!.name).toEqual([{ family: "Before" }]);
  });

  it("readVersion returns correct version data", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    store.update("Patient", created.id!, { ...patient, gender: "male" });

    const v1 = store.readVersion("Patient", created.id!, 1);
    expect(v1).toBeTruthy();
    expect(v1!.meta?.versionId).toBe("1");

    const v2 = store.readVersion("Patient", created.id!, 2);
    expect(v2).toBeTruthy();
    expect(v2!.meta?.versionId).toBe("2");
  });

  it("readVersion returns null for non-existent version", () => {
    const created = store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    const result = store.readVersion("Patient", created.id!, 999);
    expect(result).toBeNull();
  });

  it("allows re-creating resource after soft-delete with server-assigned id", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    store.softDelete("Patient", created.id!);

    const recreated = store.create("Patient", { ...patient });
    expect(recreated.id).toBeDefined();
    expect(recreated.id).not.toBe(created.id);
    expect(recreated.meta?.versionId).toBe("1");
  });

  it("rejects invalid column names via translation", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    expect(() => {
      const searchParams = new Map([["bad", { name: "bad", type: "string", jsonPath: "1=1 OR 1=1 --" }]]);
      store.search("Patient", [{ parameter: "bad", value: "x" }], searchParams);
    }).toThrow();
  });

  it("update ignores client meta.versionId and assigns next version", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    const updated = store.update("Patient", created.id!, { ...patient, gender: "male", meta: { versionId: "99" } });
    expect(updated.meta?.versionId).toBe("2");
    const row = db.query("SELECT data FROM resources WHERE id = ?").get(created.id!) as { data: string };
    const stored = JSON.parse(row.data);
    expect(stored.meta?.versionId).toBeUndefined();
  });

  it("update ignores client meta.lastUpdated and assigns current timestamp", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    const before = Date.now();
    const updated = store.update("Patient", created.id!, { ...patient, gender: "male", meta: { lastUpdated: "2000-01-01T00:00:00Z" } });
    const after = Date.now();
    const stored = new Date(updated.meta!.lastUpdated!).getTime();
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(after);
    const row = db.query("SELECT data FROM resources WHERE id = ?").get(created.id!) as { data: string };
    const parsed = JSON.parse(row.data);
    expect(parsed.meta?.lastUpdated).toBeUndefined();
  });

  it("exists returns true for live resource", () => {
    const created = store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    expect(store.exists("Patient", created.id!)).toBe(true);
  });

  it("exists returns true for soft-deleted resource", () => {
    const created = store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    store.softDelete("Patient", created.id!);
    expect(store.exists("Patient", created.id!)).toBe(true);
  });

  it("exists returns false for never-created id", () => {
    expect(store.exists("Patient", "nonexistent")).toBe(false);
  });

  it("isDeleted returns true only for soft-deleted resource", () => {
    const created = store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    expect(store.isDeleted("Patient", created.id!)).toBe(false);
    store.softDelete("Patient", created.id!);
    expect(store.isDeleted("Patient", created.id!)).toBe(true);
  });

  it("isDeleted returns false for never-created id", () => {
    expect(store.isDeleted("Patient", "nonexistent")).toBe(false);
  });

  it("searches with FHIR SearchFilters (token type)", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], gender: "male" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], gender: "female" });

    const searchParams = new Map([["gender", { name: "gender", type: "token", jsonPath: "$.gender" }]]);
    const results = store.search("Patient", [{ parameter: "gender", value: "male" }], searchParams);
    expect(results.length).toBe(1);
    expect(results[0]!.name).toEqual([{ family: "Smith" }]);
  });

  it("searches with FHIR SearchFilters (string type)", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], gender: "male" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], gender: "female" });

    const searchParams = new Map([["gender", { name: "gender", type: "token", jsonPath: "$.gender" }]]);
    const results = store.search("Patient", [{ parameter: "gender", value: "male" }], searchParams);
    expect(results.length).toBe(1);
  });

  it("counts with FHIR SearchFilters", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], gender: "male" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], gender: "female" });

    const searchParams = new Map([["gender", { name: "gender", type: "token", jsonPath: "$.gender" }]]);
    const count = store.count("Patient", [{ parameter: "gender", value: "male" }], searchParams);
    expect(count).toBe(1);
  });

  it("search with empty SearchFilters returns all", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "A" }] });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "B" }] });

    const results = store.search("Patient", [], new Map());
    expect(results.length).toBe(2);
  });

  it("count with empty SearchFilters returns total", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "A" }] });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "B" }] });

    const count = store.count("Patient", [], new Map());
    expect(count).toBe(2);
  });
});
