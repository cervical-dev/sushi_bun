import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createResourceStore } from "../../src/store/resource-store.ts";

describe("ResourceStore", () => {
  let db: Database;
  let store: ReturnType<typeof createResourceStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`
      CREATE TABLE IF NOT EXISTS resources (
        id            TEXT    NOT NULL,
        resource_type TEXT    NOT NULL,
        version_id    INTEGER NOT NULL DEFAULT 1,
        last_updated  TEXT    NOT NULL,
        is_deleted    INTEGER NOT NULL DEFAULT 0,
        data          TEXT    NOT NULL,
        PRIMARY KEY (id, resource_type)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS resources_history (
        id            TEXT    NOT NULL,
        resource_type TEXT    NOT NULL,
        version_id    INTEGER NOT NULL,
        last_updated  TEXT    NOT NULL,
        data          TEXT    NOT NULL,
        PRIMARY KEY (id, resource_type, version_id)
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type)");
    db.run("CREATE INDEX IF NOT EXISTS idx_resources_type_deleted ON resources(resource_type, is_deleted)");
    store = createResourceStore(db);
  });

  it("creates a resource and assigns an id", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    expect(created.id).toBeDefined();
    expect(created.resourceType).toBe("Patient");
    expect(created.meta?.versionId).toBe("1");
    expect(created.meta?.lastUpdated).toBeDefined();
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

  it("soft deletes a resource", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    const deleted = store.softDelete("Patient", created.id!);
    expect(deleted).toBe(true);

    const read = store.read("Patient", created.id!);
    expect(read).toBeNull();
  });

  it("returns false when deleting non-existent resource", () => {
    const deleted = store.softDelete("Patient", "non-existent");
    expect(deleted).toBe(false);
  });

  it("lists versions", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    store.update("Patient", created.id!, { ...patient, gender: "male" });
    store.update("Patient", created.id!, { ...patient, gender: "female" });

    const versions = store.listVersions("Patient", created.id!);
    expect(versions.length).toBe(3);
  });

  it("searches resources", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }] });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });

    const results = store.search("Patient", []);
    expect(results.length).toBe(3);
  });

  it("counts resources", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }] });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }] });

    const count = store.count("Patient", []);
    expect(count).toBe(2);
  });
});
