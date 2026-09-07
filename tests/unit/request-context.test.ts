import { describe, it, expect } from "bun:test";
import {
  resolveContext,
  parseAndValidateBody,
  respondWithResource,
  etag,
  historyPath,
  lastModified,
  respondMissing,
  respondDeleted,
  historyEntry,
  deletedResponse,
} from "../../src/handlers/request-context.ts";
import type { ResourceStore } from "../../src/store/types.ts";
import type { ResourceConfig } from "../../src/fhir/types.ts";
import type { ValidatorRegistry } from "../../src/fhir/validator-loader.ts";
import type { StructureDefinition } from "../../src/fhir/types.ts";

function makeConfig(type: string, interactions: string[]): ResourceConfig {
  return {
    type,
    interactions: new Set(interactions),
    searchParams: new Map(),
    operations: [],
    versioning: "versioned",
    readHistory: true,
    updateCreate: false,
    conditionalCreate: false,
    conditionalRead: "not-supported",
    conditionalUpdate: false,
    conditionalDelete: "not-supported",
  };
}

const patientSD: StructureDefinition = {
  resourceType: "StructureDefinition",
  id: "patient-sd",
  url: "http://example.org/fhir/StructureDefinition/patient-sd",
  type: "Patient",
  differential: {
    element: [
      { id: "Patient.name", path: "Patient.name", min: 1, max: "*" },
      { id: "Patient.name.family", path: "Patient.name.family", min: 1 },
    ],
  },
};

function stubValidators(sd?: StructureDefinition): ValidatorRegistry {
  const m = new Map<string, StructureDefinition>();
  if (sd) m.set(sd.url, sd);
  return {
    getValidator: (resourceType: string) => (resourceType === "Patient" ? sd : undefined),
    getAll: () => m,
  };
}

describe("resolveContext", () => {
  it("resolves create context and trusts config.type", () => {
    const config = makeConfig("Patient", ["create"]);
    const req = new Request("http://localhost:3000/Patient", { method: "POST" });
    const result = resolveContext(req, config, { interaction: "create" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.resourceType).toBe("Patient");
      expect(result.ctx.baseUrl).toBe("http://localhost:3000");
      expect(result.ctx.id).toBeUndefined();
    }
  });

  it("resolves read context with id", () => {
    const config = makeConfig("Patient", ["read"]);
    const req = new Request("http://localhost:3000/Patient/abc-123", { method: "GET" });
    const result = resolveContext(req, config, { interaction: "read", expectId: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.id).toBe("abc-123");
      expect(result.ctx.resourceType).toBe("Patient");
    }
  });

  it("returns 400 when URL type mismatches config.type", async () => {
    const config = makeConfig("Patient", ["read"]);
    const req = new Request("http://localhost:3000/Observation/xyz", { method: "GET" });
    const result = resolveContext(req, config, { interaction: "read", expectId: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome.status).toBe(400);
      const body = (await result.outcome.json()) as any;
      expect(JSON.stringify(body)).toContain("does not match");
    }
  });

  it("returns 400 when id is missing but expected", () => {
    const config = makeConfig("Patient", ["read"]);
    const req = new Request("http://localhost:3000/Patient", { method: "GET" });
    const result = resolveContext(req, config, { interaction: "read", expectId: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(400);
  });

  it("returns 400 for non-numeric vid when vid expected", () => {
    const config = makeConfig("Patient", ["history-instance"]);
    const req = new Request("http://localhost:3000/Patient/abc/_history/notanumber", { method: "GET" });
    const result = resolveContext(req, config, {
      interaction: "history-instance",
      expectId: true,
      expectVid: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(400);
  });

  it("resolves numeric vid", () => {
    const config = makeConfig("Patient", ["history-instance"]);
    const req = new Request("http://localhost:3000/Patient/abc/_history/3", { method: "GET" });
    const result = resolveContext(req, config, {
      interaction: "history-instance",
      expectId: true,
      expectVid: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.vid).toBe(3);
  });

  it("returns 405 when interaction not allowed", () => {
    const config = makeConfig("Patient", ["read"]);
    const req = new Request("http://localhost:3000/Patient/abc", { method: "GET" });
    const result = resolveContext(req, config, { interaction: "delete", expectId: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(405);
  });
});

describe("parseAndValidateBody", () => {
  it("returns 415 on wrong content type", async () => {
    const config = makeConfig("Patient", ["create"]);
    const req = new Request("http://localhost:3000/Patient", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    const ctxResult = resolveContext(req, config, { interaction: "create" });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "none",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(415);
  });

  it("returns 400 on invalid JSON", async () => {
    const config = makeConfig("Patient", ["create"]);
    const req = new Request("http://localhost:3000/Patient", {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: "{not json",
    });
    const ctxResult = resolveContext(req, config, { interaction: "create" });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "none",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(400);
  });

  it("returns 400 when body resourceType mismatches URL", async () => {
    const config = makeConfig("Patient", ["create"]);
    const req = new Request("http://localhost:3000/Patient", {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({ resourceType: "Observation", status: "final" }),
    });
    const ctxResult = resolveContext(req, config, { interaction: "create" });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "none",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(400);
  });

  it("returns 400 when body id mismatches URL with checkIdMatch", async () => {
    const config = makeConfig("Patient", ["update"]);
    const req = new Request("http://localhost:3000/Patient/aaa", {
      method: "PUT",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({ resourceType: "Patient", id: "bbb" }),
    });
    const ctxResult = resolveContext(req, config, { interaction: "update", expectId: true });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "none",
      checkIdMatch: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(400);
  });

  it("returns 400 on malformed If-Match", async () => {
    const config = makeConfig("Patient", ["update"]);
    const req = new Request("http://localhost:3000/Patient/aaa", {
      method: "PUT",
      headers: { "Content-Type": "application/fhir+json", "If-Match": "not-an-etag" },
      body: JSON.stringify({ resourceType: "Patient", id: "aaa" }),
    });
    const ctxResult = resolveContext(req, config, { interaction: "update", expectId: true });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "none",
      checkIdMatch: true,
      parseIfMatch: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(400);
  });

  it("parses valid If-Match into expectedVersion", async () => {
    const config = makeConfig("Patient", ["update"]);
    const req = new Request("http://localhost:3000/Patient/aaa", {
      method: "PUT",
      headers: { "Content-Type": "application/fhir+json", "If-Match": 'W/"7"' },
      body: JSON.stringify({ resourceType: "Patient", id: "aaa" }),
    });
    const ctxResult = resolveContext(req, config, { interaction: "update", expectId: true });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "none",
      checkIdMatch: true,
      parseIfMatch: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expectedVersion).toBe(7);
  });

  it("returns 400 on empty patch ops array", async () => {
    const config = makeConfig("Patient", ["patch"]);
    const req = new Request("http://localhost:3000/Patient/aaa", {
      method: "PATCH",
      headers: { "Content-Type": "application/json-patch+json" },
      body: JSON.stringify([]),
    });
    const ctxResult = resolveContext(req, config, { interaction: "patch", expectId: true });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
      contentTypes: ["application/json-patch+json"],
      validateAs: "patch-ops",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(400);
  });

  it("returns 422 when resource fails validation", async () => {
    const config = makeConfig("Patient", ["create"]);
    const validators = stubValidators(patientSD);
    const req = new Request("http://localhost:3000/Patient", {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({ resourceType: "Patient" }),
    });
    const ctxResult = resolveContext(req, config, { interaction: "create" });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, validators, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "resource",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome.status).toBe(422);
  });

  it("passes validation for a conformant resource", async () => {
    const config = makeConfig("Patient", ["create"]);
    const validators = stubValidators(patientSD);
    const req = new Request("http://localhost:3000/Patient", {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({ resourceType: "Patient", name: [{ family: "Smith" }] }),
    });
    const ctxResult = resolveContext(req, config, { interaction: "create" });
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const result = await parseAndValidateBody(req, ctxResult.ctx, validators, {
      contentTypes: ["application/fhir+json", "application/json"],
      validateAs: "resource",
    });
    expect(result.ok).toBe(true);
  });
});

describe("respondWithResource", () => {
  it("builds Location, ETag and Last-Modified headers", async () => {
    const resource: any = {
      resourceType: "Patient",
      id: "abc",
      meta: { versionId: "2", lastUpdated: "2026-09-06T00:00:00.000Z" },
    };
    const res = respondWithResource(resource, "http://localhost:3000", 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Location")).toBe("http://localhost:3000/Patient/abc/_history/2");
    expect(res.headers.get("ETag")).toBe('W/"2"');
    expect(res.headers.get("Last-Modified")).toBe("2026-09-06T00:00:00.000Z");
    const body = (await res.json()) as any;
    expect(body.id).toBe("abc");
  });

  it("omits Location when asked (plain read shape)", async () => {
    const resource: any = {
      resourceType: "Patient",
      id: "abc",
      meta: { versionId: "2", lastUpdated: "2026-09-06T00:00:00.000Z" },
    };
    const res = respondWithResource(resource, "http://localhost:3000", 200, { location: false });
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("ETag")).toBe('W/"2"');
    expect(res.headers.get("Last-Modified")).toBe("2026-09-06T00:00:00.000Z");
  });
});

function fakeStore(current: { versionId: number; isDeleted: boolean } | null): ResourceStore {
  return { currentVersion: () => current } as unknown as ResourceStore;
}

describe("etag", () => {
  it("wraps numbers and strings weakly", () => {
    expect(etag(3)).toBe('W/"3"');
    expect(etag("12")).toBe('W/"12"');
  });
});

describe("historyPath", () => {
  it("builds the instance-version path", () => {
    expect(historyPath("Patient", "abc", 2)).toBe("Patient/abc/_history/2");
  });
});

describe("lastModified", () => {
  it("uses meta.lastUpdated when present", () => {
    const res: any = { resourceType: "Patient", id: "a", meta: { lastUpdated: "2026-01-01T00:00:00.000Z" } };
    expect(lastModified(res)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to a parseable timestamp when absent", () => {
    const res: any = { resourceType: "Patient", id: "a" };
    expect(isNaN(Date.parse(lastModified(res)))).toBe(false);
  });
});

describe("respondMissing", () => {
  it("answers 404 not-found with an Outcome and no ETag when the resource never existed", async () => {
    const res = respondMissing(fakeStore(null), "Patient", "abc");
    expect(res.status).toBe(404);
    expect(res.headers.get("ETag")).toBeNull();
    const body = (await res.json()) as any;
    expect(body.resourceType).toBe("OperationOutcome");
    expect(body.issue[0].code).toBe("not-found");
    expect(body.issue[0].diagnostics).toContain("Patient/abc");
  });

  it("answers 410 gone with ETag and deleted Outcome when the current version is deleted", async () => {
    const res = respondMissing(fakeStore({ versionId: 3, isDeleted: true }), "Patient", "abc");
    expect(res.status).toBe(410);
    expect(res.headers.get("ETag")).toBe('W/"3"');
    const body = (await res.json()) as any;
    expect(body.issue[0].code).toBe("deleted");
    expect(body.issue[0].diagnostics).toContain("Patient/abc is deleted");
  });

  it("answers 404 when the store reports a live current version (contradictory read)", async () => {
    const res = respondMissing(fakeStore({ versionId: 1, isDeleted: false }), "Patient", "abc");
    expect(res.status).toBe(404);
  });
});

describe("respondDeleted", () => {
  it("answers 204 with the latest-version ETag", () => {
    const res = respondDeleted(fakeStore({ versionId: 5, isDeleted: true }), "Patient", "abc");
    expect(res.status).toBe(204);
    expect(res.headers.get("ETag")).toBe('W/"5"');
  });

  it("answers 204 with ETag W/\"1\" when no version info exists", () => {
    const res = respondDeleted(fakeStore(null), "Patient", "abc");
    expect(res.status).toBe(204);
    expect(res.headers.get("ETag")).toBe('W/"1"');
  });
});

describe("deletedResponse", () => {
  it("gives the shared 410 rule as Bundle-entry data: status, latest-version ETag, deleted Outcome", () => {
    const r = deletedResponse(fakeStore({ versionId: 4, isDeleted: true }), "Patient", "abc");
    expect(r.status).toBe("410");
    expect(r.etag).toBe('W/"4"');
    const outcome = r.outcome as any;
    expect(outcome.resourceType).toBe("OperationOutcome");
    expect(outcome.issue[0].code).toBe("deleted");
    expect(outcome.issue[0].diagnostics).toBe("Patient/abc is deleted");
  });

  it("falls back to version 1 when the store reports no current version", () => {
    const r = deletedResponse(fakeStore(null), "Patient", "abc");
    expect(r.etag).toBe('W/"1"');
  });
});

describe("historyEntry", () => {
  it("builds a versioned history entry through the shared path and etag rules", () => {
    const resource: any = { resourceType: "Patient", id: "abc" };
    const entry = historyEntry({
      resourceType: "Patient",
      id: "abc",
      versionId: 2,
      lastUpdated: "2026-09-06T00:00:00.000Z",
      resource,
    });
    expect(entry.fullUrl).toBe("Patient/abc/_history/2");
    expect(entry.request).toEqual({ method: "GET", url: "Patient/abc/_history/2" });
    expect(entry.resource).toBe(resource);
    expect(entry.response).toEqual({
      status: "200",
      lastModified: "2026-09-06T00:00:00.000Z",
      etag: 'W/"2"',
    });
  });
});
