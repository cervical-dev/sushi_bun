import { describe, it, expect } from "bun:test";
import {
  resolveContext,
  parseAndValidateBody,
  respondWithResource,
} from "../../src/handlers/request-context.ts";
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
});
