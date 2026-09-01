import { describe, it, expect, beforeEach } from "bun:test";
import { createTestStore } from "../helpers.ts";

describe("ResourceStore", () => {
  let store: ReturnType<typeof createTestStore>["store"];

  beforeEach(() => {
    const s = createTestStore();
    store = s.store;
  });

  it("creates a resource and assigns an id", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);

    expect(created.id).toBeDefined();
    expect(created.resourceType).toBe("Patient");
    expect(created.meta?.versionId).toBe("1");
    expect(created.meta?.lastUpdated).toBeDefined();
  });

  it("creates with client-supplied id", () => {
    const patient = { resourceType: "Patient", id: "my-custom-id", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    expect(created.id).toBe("my-custom-id");
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
    expect(versions[1]!.version_id).toBe(2);
  });

  it("returns false when deleting non-existent resource", () => {
    const deleted = store.softDelete("Patient", "non-existent");
    expect(deleted).toBe(false);
  });

  it("listVersions returns correct shape", () => {
    const patient = { resourceType: "Patient", name: [{ family: "Smith" }] };
    const created = store.create("Patient", patient);
    store.update("Patient", created.id!, { ...patient, gender: "male" });

    const versions = store.listVersions("Patient", created.id!);
    expect(versions.length).toBe(2);
    expect(versions[0]!.version_id).toBe(1);
    expect(versions[0]!.last_updated).toBeDefined();
    expect(versions[1]!.version_id).toBe(2);
  });

  it("searches with SQL filters", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], gender: "male" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], gender: "female" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith2" }], gender: "male" });

    const results = store.search("Patient", [{ column: "json:$.gender", op: "=", value: "male" }]);
    expect(results.length).toBe(2);
  });

  it("searches excludes soft-deleted resources", () => {
    const p = store.create("Patient", { resourceType: "Patient", name: [{ family: "Doomed" }] });
    store.softDelete("Patient", p.id!);

    const results = store.search("Patient", []);
    expect(results.length).toBe(0);
  });

  it("search with pagination", () => {
    for (let i = 0; i < 10; i++) {
      store.create("Patient", { resourceType: "Patient", name: [{ family: `Patient${i}` }] });
    }

    const page1 = store.search("Patient", [], 0, 3);
    expect(page1.length).toBe(3);

    const page2 = store.search("Patient", [], 3, 3);
    expect(page2.length).toBe(3);

    const page4 = store.search("Patient", [], 9, 3);
    expect(page4.length).toBe(1);
  });

  it("count with filters", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Smith" }], gender: "male" });
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }], gender: "female" });

    const maleCount = store.count("Patient", [{ column: "json:$.gender", op: "=", value: "male" }]);
    expect(maleCount).toBe(1);

    const totalCount = store.count("Patient", []);
    expect(totalCount).toBe(2);
  });

  it("rejects invalid SQL operators", () => {
    expect(() => {
      store.search("Patient", [{ column: "json:$.gender", op: "DROP TABLE", value: "male" }]);
    }).toThrow("Invalid SQL operator");
  });

  it("transaction rolls back on error", () => {
    store.create("Patient", { resourceType: "Patient", name: [{ family: "Before" }] });

    try {
      store.transaction(() => {
        store.create("Patient", { resourceType: "Patient", name: [{ family: "Inside" }] });
        throw new Error("Rollback!");
      });
    } catch {}

    const results = store.search("Patient", []);
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
});
