import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { createTestServer, createClient, validPatient, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

interface ApiModel {
  ids: string[];
  state: Map<string, { version: number; deleted: boolean; body: any }>;
}

function pickId(m: ApiModel, idxOffset: number): string | undefined {
  if (m.ids.length === 0) return undefined;
  return m.ids[idxOffset % m.ids.length];
}

class CreateCmd implements fc.AsyncCommand<ApiModel, FhirClient, true> {
  async check() { return true; }
  async run(m: ApiModel, client: FhirClient) {
    const patient = validPatient();
    const res = await client.create("Patient", patient);
    expect(res.status).toBe(201);
    expect(res.body.meta?.versionId).toBe("1");
    expect(res.headers.get("ETag")).toBe('W/"1"');
    expect(res.headers.get("Location")).toContain(`Patient/${res.body.id}/_history/1`);
    m.ids.push(res.body.id);
    m.state.set(res.body.id, { version: 1, deleted: false, body: res.body });
    return res;
  }
  toString() { return "Create"; }
}

class ReadCmd implements fc.AsyncCommand<ApiModel, FhirClient, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: ApiModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined && !m.state.get(this.resolvedId)!.deleted;
  }
  async run(m: ApiModel, client: FhirClient) {
    const id = this.resolvedId!;
    const model = m.state.get(id)!;
    const res = await client.read("Patient", id);
    expect(res.status).toBe(200);
    expect(res.body.meta?.versionId).toBe(String(model.version));
    expect(res.headers.get("ETag")).toBe(`W/"${model.version}"`);
    return res;
  }
  toString() { return `Read(${this.resolvedId ?? "?"})`; }
}

class UpdateCmd implements fc.AsyncCommand<ApiModel, FhirClient, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: ApiModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined && !m.state.get(this.resolvedId)!.deleted;
  }
  async run(m: ApiModel, client: FhirClient) {
    const id = this.resolvedId!;
    const model = m.state.get(id)!;
    const res = await client.update("Patient", id, {
      ...model.body,
      name: [{ family: "Updated", given: ["Test"] }],
    }, `W/"${model.version}"`);
    expect(res.status).toBe(200);
    const newVersion = model.version + 1;
    expect(res.body.meta?.versionId).toBe(String(newVersion));
    expect(res.headers.get("ETag")).toBe(`W/"${newVersion}"`);
    model.version = newVersion;
    model.body = res.body;
    return res;
  }
  toString() { return `Update(${this.resolvedId ?? "?"})`; }
}

class StaleUpdateCmd implements fc.AsyncCommand<ApiModel, FhirClient, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: ApiModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined && !m.state.get(this.resolvedId)!.deleted;
  }
  async run(m: ApiModel, client: FhirClient) {
    const id = this.resolvedId!;
    const model = m.state.get(id)!;
    const res = await client.update("Patient", id, {
      ...model.body,
      name: [{ family: "Stale", given: ["Test"] }],
    }, 'W/"999"');
    expect(res.status).toBe(412);
    return res;
  }
  toString() { return `StaleUpdate(${this.resolvedId ?? "?"})`; }
}

class DeleteCmd implements fc.AsyncCommand<ApiModel, FhirClient, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: ApiModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined && !m.state.get(this.resolvedId)!.deleted;
  }
  async run(m: ApiModel, client: FhirClient) {
    const id = this.resolvedId!;
    const model = m.state.get(id)!;
    const res = await client.delete("Patient", id);
    expect(res.status).toBe(204);
    model.deleted = true;
    model.version += 1;
    return res;
  }
  toString() { return `Delete(${this.resolvedId ?? "?"})`; }
}

class VReadCmd implements fc.AsyncCommand<ApiModel, FhirClient, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number, private readonly versionOffset: number) {}
  async check(m: ApiModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined;
  }
  async run(m: ApiModel, client: FhirClient) {
    const id = this.resolvedId!;
    const model = m.state.get(id)!;
    const version = Math.min(this.versionOffset, model.version + 2);
    const res = await client.vread("Patient", id, String(version));
    if (model.deleted && version === model.version) {
      expect(res.status).toBe(410);
    } else if (version <= model.version) {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(404);
    }
    return res;
  }
  toString() { return `VRead(${this.resolvedId ?? "?"}, v${this.versionOffset})`; }
}

class HistoryCmd implements fc.AsyncCommand<ApiModel, FhirClient, true> {
  private resolvedId?: string;
  constructor(private readonly idxOffset: number) {}
  async check(m: ApiModel) {
    this.resolvedId = pickId(m, this.idxOffset);
    return this.resolvedId !== undefined;
  }
  async run(m: ApiModel, client: FhirClient) {
    const id = this.resolvedId!;
    const model = m.state.get(id)!;
    const res = await client.history("Patient", id);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe("Bundle");
    expect(res.body.type).toBe("history");
    expect(res.body.entry.length).toBe(model.version);
    return res;
  }
  toString() { return `History(${this.resolvedId ?? "?"})`; }
}

describe("Stateful API Command Properties", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  it("100 runs: CRUD lifecycle with version monotony, stale ETag, delete semantics", async () => {
    const model: ApiModel = { ids: [], state: new Map() };
    await fc.assert(
      fc.asyncProperty(
        fc.commands([
          fc.constant(new CreateCmd()),
          fc.integer({ min: 0, max: 99 }).map(i => new ReadCmd(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new UpdateCmd(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new StaleUpdateCmd(i)),
          fc.integer({ min: 0, max: 99 }).map(i => new DeleteCmd(i)),
          fc.tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 1, max: 3 })).map(([i, v]) => new VReadCmd(i, v)),
          fc.integer({ min: 0, max: 99 }).map(i => new HistoryCmd(i)),
        ], { maxCommands: 15 }),
        async (cmds) => {
          model.ids = [];
          model.state = new Map();
          await fc.asyncModelRun(() => ({ model, real: client }), cmds);
        }
      ),
      { numRuns: 100, endOnFailure: true }
    );
  });
});
