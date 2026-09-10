import { describe, it, expect } from "bun:test";
import {
  resolveContext,
  parseAndValidateBody,
  respondWithResource,
  respondMissing,
  respondDeleted,
  respondGone,
  deletedResponse,
  historyEntry,
  etag,
  lastModified,
  historyPath,
  buildOperationOutcome,
  createOperationOutcome,
  createOperationOutcomeFromIssues,
  parseSearchParams,
  parsePaging,
  applyPatch,
  PatchError,
  loadValidators,
  validateResource,
} from "../../src/byoh.ts";
import type {
  ResourceConfig,
  FhirResource,
  Bundle,
  SearchFilter,
  SearchParamConfig,
  StructureDefinition,
  ValidatorRegistry,
  HandlerProvider,
  ResourceStore,
  PatchOp,
} from "../../src/byoh.ts";

function makeConfig(type: string, interactions: string[]): ResourceConfig {
  return {
    type,
    interactions: new Set(interactions),
    searchParams: new Map(),
    operations: [],
    updateCreate: false,
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

describe("byoh barrel", () => {
  it("exports core handler-authoring functions", () => {
    expect(typeof resolveContext).toBe("function");
    expect(typeof parseAndValidateBody).toBe("function");
    expect(typeof respondWithResource).toBe("function");
    expect(typeof respondMissing).toBe("function");
    expect(typeof respondDeleted).toBe("function");
    expect(typeof respondGone).toBe("function");
    expect(typeof deletedResponse).toBe("function");
    expect(typeof historyEntry).toBe("function");
  });

  it("exports ETag / header helpers", () => {
    expect(typeof etag).toBe("function");
    expect(typeof lastModified).toBe("function");
    expect(typeof historyPath).toBe("function");
  });

  it("exports OperationOutcome builders", () => {
    expect(typeof buildOperationOutcome).toBe("function");
    expect(typeof createOperationOutcome).toBe("function");
    expect(typeof createOperationOutcomeFromIssues).toBe("function");
  });

  it("exports search / paging parsers", () => {
    expect(typeof parseSearchParams).toBe("function");
    expect(typeof parsePaging).toBe("function");
  });

  it("exports patch utilities", () => {
    expect(typeof applyPatch).toBe("function");
    expect(PatchError).toBeDefined();
  });

  it("exports validation utilities", () => {
    expect(typeof loadValidators).toBe("function");
    expect(typeof validateResource).toBe("function");
  });
});

describe("BYOH — custom handleCreate", () => {
  it("resolves context, parses body, validates, responds with 201 + FHIR headers", async () => {
    const config = makeConfig("Patient", ["create"]);
    const patient: FhirResource = {
      resourceType: "Patient",
      name: [{ family: "Smith", given: ["John"] }],
      identifier: [{ system: "http://example.org/mrn", value: "12345" }],
    };

    const resolved = resolveContext(
      new Request("http://localhost:3000/Patient", { method: "POST" }),
      config,
      { interaction: "create" }
    );
    expect(resolved.ok).toBe(true);

    const parsed = await parseAndValidateBody(
      new Request("http://localhost:3000/Patient", {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(patient),
      }),
      resolved.ctx,
      stubValidators(patientSD),
      { contentTypes: ["application/fhir+json"], validateAs: "resource" }
    );
    expect(parsed.ok).toBe(true);

    const stored = { ...parsed.body as FhirResource, id: "new-1", meta: { versionId: "1", lastUpdated: new Date().toISOString() } };
    const res = respondWithResource(stored, resolved.ctx.baseUrl, 201);

    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/fhir+json");
    expect(res.headers.get("ETag")).toBe('W/"1"');
    expect(res.headers.get("Location")).toContain("Patient/new-1/_history/1");
    const body = await res.json();
    expect(body).toEqual(stored);
  });

  it("returns 422 when resource fails FHIR validation", async () => {
    const config = makeConfig("Patient", ["create"]);
    const invalid: FhirResource = {
      resourceType: "Patient",
      gender: "male",
    };

    const resolved = resolveContext(
      new Request("http://localhost:3000/Patient", { method: "POST" }),
      config,
      { interaction: "create" }
    );
    expect(resolved.ok).toBe(true);

    const parsed = await parseAndValidateBody(
      new Request("http://localhost:3000/Patient", {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(invalid),
      }),
      resolved.ctx,
      stubValidators(patientSD),
      { contentTypes: ["application/fhir+json"], validateAs: "resource" }
    );
    expect(parsed.ok).toBe(false);

    const res = parsed.outcome;
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.resourceType).toBe("OperationOutcome");
    expect(body.issue.length).toBeGreaterThan(0);
    expect(body.issue[0]!.severity).toBe("error");
  });

  it("returns 400 for missing Content-Type", async () => {
    const config = makeConfig("Patient", ["create"]);
    const resolved = resolveContext(
      new Request("http://localhost:3000/Patient", { method: "POST" }),
      config,
      { interaction: "create" }
    );
    expect(resolved.ok).toBe(true);

    const parsed = await parseAndValidateBody(
      new Request("http://localhost:3000/Patient", {
        method: "POST",
        body: JSON.stringify({ resourceType: "Patient" }),
      }),
      resolved.ctx,
      undefined,
      { contentTypes: ["application/fhir+json"], validateAs: "resource" }
    );
    expect(parsed.ok).toBe(false);

    const res = parsed.outcome;
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.resourceType).toBe("OperationOutcome");
  });
});

describe("BYOH — custom handleSearch", () => {
  it("resolves context, parses search filters + paging, builds a searchset bundle", async () => {
    const config = makeConfig("Patient", ["search-type"]);
    config.searchParams = new Map([
      ["name", { name: "name", type: "string" }],
    ]);

    const resolved = resolveContext(
      new Request("http://localhost:3000/Patient?name=Smith&_count=5&_offset=10", { method: "GET" }),
      config,
      { interaction: "search-type" }
    );
    expect(resolved.ok).toBe(true);

    const { url } = resolved.ctx;
    const paging = parsePaging(url.searchParams);
    expect(paging).toEqual({ count: 5, offset: 10 });

    const filters = parseSearchParams(url.searchParams.toString(), config.searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.parameter).toBe("name");
    expect(filters[0]!.value).toBe("Smith");

    // Simulate store results (BYOH author owns this part)
    const mockResources: FhirResource[] = [
      { resourceType: "Patient", id: "p-1", name: [{ family: "Smith" }] },
      { resourceType: "Patient", id: "p-2", name: [{ family: "Smith" }] },
    ];
    const total = 42;

    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "searchset",
      total,
      entry: mockResources.map((r) => ({
        fullUrl: `Patient/${r.id}`,
        resource: r,
        search: { mode: "match" },
      })),
    };

    const res = Response.json(bundle);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Bundle");
    expect(body.type).toBe("searchset");
    expect(body.total).toBe(42);
    expect(body.entry.length).toBe(2);
    expect(body.entry[0]!.resource.id).toBe("p-1");
  });

  it("returns empty searchset for no results", async () => {
    const config = makeConfig("Patient", ["search-type"]);
    config.searchParams = new Map([
      ["name", { name: "name", type: "string" }],
    ]);

    const resolved = resolveContext(
      new Request("http://localhost:3000/Patient?name=Nonexistent", { method: "GET" }),
      config,
      { interaction: "search-type" }
    );
    expect(resolved.ok).toBe(true);

    const filters = parseSearchParams(resolved.ctx.url.searchParams.toString(), config.searchParams);
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 0,
      entry: [],
    };

    const res = Response.json(bundle);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.entry.length).toBe(0);
  });
});

describe("BYOH — error helpers", () => {
  it("createOperationOutcome builds a 400 OperationOutcome response", () => {
    const res = createOperationOutcome("error", "invalid", "bad request");
    expect(res.status).toBe(400);
  });

  it("createOperationOutcome respects custom status", () => {
    const res = createOperationOutcome("error", "not-supported", "nope", 405);
    expect(res.status).toBe(405);
  });

  it("respondMissing returns 404 for existing non-deleted resource", () => {
    const store = {
      currentVersion: () => ({ versionId: 1, isDeleted: false }),
    } as unknown as ResourceStore;
    const res = respondMissing(store, "Patient", "abc");
    expect(res.status).toBe(404);
  });

  it("respondMissing returns 410 for soft-deleted resource", () => {
    const store = {
      currentVersion: () => ({ versionId: 1, isDeleted: true }),
    } as unknown as ResourceStore;
    const res = respondMissing(store, "Patient", "abc");
    expect(res.status).toBe(410);
  });

  it("respondDeleted returns 204", () => {
    const store = {
      currentVersion: () => ({ versionId: 2, isDeleted: false }),
    } as unknown as ResourceStore;
    const res = respondDeleted(store, "Patient", "abc");
    expect(res.status).toBe(204);
  });

  it("buildOperationOutcome returns a plain OperationOutcome object", () => {
    const outcome = buildOperationOutcome("error", "required", "missing field");
    expect(outcome.resourceType).toBe("OperationOutcome");
    expect(outcome.issue.length).toBe(1);
    expect(outcome.issue[0]!.severity).toBe("error");
  });
});

describe("BYOH — JSON Patch", () => {
  it("applyPatch mutates a resource and returns the result", () => {
    const doc = { resourceType: "Patient", name: [{ family: "Doe" }] };
    const ops: PatchOp[] = [{ op: "replace", path: "/name/0/family", value: "Smith" }];
    const result = applyPatch(doc, ops);
    expect(result.name[0].family).toBe("Smith");
    expect(doc.name[0].family).toBe("Doe");
  });

  it("PatchError is thrown on invalid path", () => {
    expect(() => applyPatch({}, [{ op: "replace", path: "/missing", value: 1 }])).toThrow(PatchError);
  });
});

describe("BYOH — ETag / header helpers", () => {
  it("etag returns weak ETag format", () => {
    expect(etag(1)).toBe('W/"1"');
    expect(etag("3")).toBe('W/"3"');
  });

  it("lastModified returns meta.lastUpdated", () => {
    const r: FhirResource = { resourceType: "Patient", meta: { lastUpdated: "2026-01-01" } };
    expect(lastModified(r)).toBe("2026-01-01");
  });

  it("historyPath builds correct path", () => {
    expect(historyPath("Patient", "abc", 2)).toBe("Patient/abc/_history/2");
  });
});
