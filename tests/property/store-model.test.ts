import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";
import { createDatabase } from "../../src/db.ts";
import { createResourceStore } from "../../src/store/resource-store.ts";

interface StoreModel {
  ids: string[];
  resources: Map<string, { version: number; deleted: boolean; body: any }>;
}

type Store = ReturnType<typeof createResourceStore>;

function pickId(m: StoreModel, idxOffset: number): string | undefined {
  if (m.ids.length === 0) return undefined;
  return m.ids[idxOffset % m.ids.length];
}

class CreateCommand implements fc.AsyncCommand<StoreModel, Store, true> {
  constructor(readonly resourceType: string, readonly body: any) {}
  async check() { return true; }
  async run(m: StoreModel, store: Store) {
    const result = store.create(this.resourceType, this.body);
    const id = result.id!;
    m.ids.push(id);
    m.resources.set(id, { version: 1, deleted: false, body: result });
    return result;
  }
  toString() { return `Create(${this.resourceType})`; }
}

class ReadCommand implements fc.AsyncCommand<StoreModel, Store, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: StoreModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined;
  }
  async run(m: StoreModel, store: Store) {
    const id = this.resolvedId!;
    const model = m.resources.get(id)!;
    const result = store.read(model.body.resourceType, id);
    if (model.deleted) {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      expect(result!.meta?.versionId).toBe(String(model.version));
    }
    return result;
  }
  toString() { return `Read(${this.resolvedId ?? "?"})`; }
}

class UpdateCommand implements fc.AsyncCommand<StoreModel, Store, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: StoreModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    if (!this.resolvedId) return false;
    const model = m.resources.get(this.resolvedId);
    return model !== undefined && !model.deleted;
  }
  async run(m: StoreModel, store: Store) {
    const id = this.resolvedId!;
    const model = m.resources.get(id)!;
    const newVersion = model.version + 1;
    const result = store.update(model.body.resourceType, id, { ...model.body, updated: true }, model.version);
    model.version = newVersion;
    model.body = result;
    return result;
  }
  toString() { return `Update(${this.resolvedId ?? "?"})`; }
}

class DeleteCommand implements fc.AsyncCommand<StoreModel, Store, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: StoreModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    if (!this.resolvedId) return false;
    const model = m.resources.get(this.resolvedId);
    return model !== undefined && !model.deleted;
  }
  async run(m: StoreModel, store: Store) {
    const id = this.resolvedId!;
    const model = m.resources.get(id)!;
    const result = store.softDelete(model.body.resourceType, id);
    expect(result).toBe(true);
    model.deleted = true;
    model.version += 1;
    return result;
  }
  toString() { return `Delete(${this.resolvedId ?? "?"})`; }
}

class ListVersionsCommand implements fc.AsyncCommand<StoreModel, Store, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: StoreModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined;
  }
  async run(m: StoreModel, store: Store) {
    const id = this.resolvedId!;
    const model = m.resources.get(id)!;
    const versions = store.listVersions(model.body.resourceType, id);
    expect(versions.length).toBe(model.version);
    return versions;
  }
  toString() { return `ListVersions(${this.resolvedId ?? "?"})`; }
}

class ExistsCommand implements fc.AsyncCommand<StoreModel, Store, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: StoreModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined;
  }
  async run(m: StoreModel, store: Store) {
    const id = this.resolvedId!;
    const model = m.resources.get(id)!;
    const exists = store.exists(model.body.resourceType, id);
    expect(exists).toBe(true);
    return exists;
  }
  toString() { return `Exists(${this.resolvedId ?? "?"})`; }
}

class IsDeletedCommand implements fc.AsyncCommand<StoreModel, Store, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: StoreModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined;
  }
  async run(m: StoreModel, store: Store) {
    const id = this.resolvedId!;
    const model = m.resources.get(id)!;
    const isDeleted = store.isDeleted(model.body.resourceType, id);
    expect(isDeleted).toBe(model.deleted);
    return isDeleted;
  }
  toString() { return `IsDeleted(${this.resolvedId ?? "?"})`; }
}

describe("ResourceStore Model-Based Tests", () => {
  it("5000 runs: version monotony, delete semantics, exists/isDeleted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands([
          fc.constant(new CreateCommand("Patient", { resourceType: "Patient", name: [{ family: "Test" }] })),
          fc.constant(new CreateCommand("Observation", { resourceType: "Observation", status: "final" })),
          fc.integer({ min: 0, max: 99 }).map(i => new ReadCommand(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new UpdateCommand(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new DeleteCommand(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new ListVersionsCommand(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new ExistsCommand(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new IsDeletedCommand(i)),
        ], { maxCommands: 20 }),
        async (cmds) => {
          const db = createDatabase(":memory:");
          const store = createResourceStore(db);
          const model: StoreModel = { ids: [], resources: new Map() };
          await fc.asyncModelRun(() => ({ model, real: store }), cmds);
          db.close();
          db.close();
        }
      ),
      { numRuns: 5000, endOnFailure: true }
    );
  });
});
