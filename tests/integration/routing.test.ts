import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, createTestServerWithCapability, type TestServer } from "../helpers.ts";

describe("Server routing respects CapabilityStatement", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
  });

  afterAll(() => {
    server.stop();
  });

  it("serves metadata at /metadata", async () => {
    const res = await fetch(`${server.baseUrl}/metadata`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.resourceType).toBe("CapabilityStatement");
  });

  it("returns 200 for Patient read (supported)", async () => {
    const created = server.store.create("Patient", {
      resourceType: "Patient",
      name: [{ family: "Smith", given: ["John"] }],
    });

    const res = await fetch(`${server.baseUrl}/Patient/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.resourceType).toBe("Patient");
    expect(res.headers.get("ETag")).toBe(`W/"1"`);
  });

  it("returns 200 for Patient search (supported)", async () => {
    server.store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }] });

    const res = await fetch(`${server.baseUrl}/Patient?name=Jones`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.resourceType).toBe("Bundle");
    expect(body.type).toBe("searchset");
  });

  it("returns 201 for Patient create (supported)", async () => {
    const res = await fetch(`${server.baseUrl}/Patient`, {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({
        resourceType: "Patient",
        name: [{ family: "Test", given: ["Create"] }],
        gender: "female",
        birthDate: "2000-01-01",
        identifier: [{ system: "http://example.org/mrn", value: "routing-create" }],
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Location")).toContain("Patient/");
    expect(res.headers.get("ETag")).toBeDefined();
  });

  it("returns 200 for Patient update (supported)", async () => {
    const created = server.store.create("Patient", {
      resourceType: "Patient",
      name: [{ family: "ToUpdate" }],
    });

    const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({
        resourceType: "Patient",
        id: created.id,
        name: [{ family: "Updated", given: ["Jane"] }],
        gender: "female",
        birthDate: "1990-01-01",
        identifier: [{ system: "http://example.org/mrn", value: "routing-update" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.meta?.versionId).toBe("2");
  });

  it("returns 204 for Patient delete (supported)", async () => {
    const created = server.store.create("Patient", {
      resourceType: "Patient",
      name: [{ family: "ToDelete" }],
    });

    const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 for unsupported resource type (Observation create)", async () => {
    // Observation only has read + search-type, no create route registered
    const res = await fetch(`${server.baseUrl}/Observation`, {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      }),
    });
    // Bun returns 404 for unmatched method on a route
    expect(res.status).toBe(404);
  });

  it("returns 404 for completely unknown resource type", async () => {
    const res = await fetch(`${server.baseUrl}/Encounter`);
    expect(res.status).toBe(404);
  });

  it("returns 200 for Observation read (supported)", async () => {
    const patient = server.store.create("Patient", {
      resourceType: "Patient",
      name: [{ family: "ObsPatient" }],
    });

    const obs = server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      subject: { reference: `Patient/${patient.id}` },
    });

    const res = await fetch(`${server.baseUrl}/Observation/${obs.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.resourceType).toBe("Observation");
  });

  it("returns 404 for Observation update (not registered)", async () => {
    const obs = server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    });

    const res = await fetch(`${server.baseUrl}/Observation/${obs.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify({ resourceType: "Observation", status: "amended" }),
    });
    // Bun returns 404 for unmatched method when route exists but method not registered
    expect(res.status).toBe(404);
  });

  it("returns 404 for Observation delete (not registered)", async () => {
    const obs = server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    });

    const res = await fetch(`${server.baseUrl}/Observation/${obs.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("serves root path with information message", async () => {
    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.resourceType).toBe("OperationOutcome");
  });

  describe("HEAD support", () => {
    it("returns same headers as GET with no body", async () => {
      const created = server.store.create("Patient", {
        resourceType: "Patient",
        name: [{ family: "HeadTest" }],
      });

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("ETag")).toBeDefined();
      expect(res.headers.get("Content-Type")).toBe("application/fhir+json");
      const text = await res.text();
      expect(text).toBe("");
    });
  });

  describe("trailing slash", () => {
    it("serves resource with trailing slash", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("Bundle");
    });
  });

  describe("CORS", () => {
    it("includes CORS headers on response", async () => {
      const res = await fetch(`${server.baseUrl}/metadata`);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("Date header", () => {
    it("includes Date header on response", async () => {
      const res = await fetch(`${server.baseUrl}/metadata`);
      expect(res.headers.get("Date")).toBeDefined();
    });
  });

  describe("content negotiation", () => {
    it("returns 406 for unsupported Accept header", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        headers: { Accept: "application/xml" },
      });
      expect(res.status).toBe(406);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
    });

    it("returns json for standard Accept header", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        headers: { Accept: "application/fhir+json" },
      });
      expect(res.status).toBe(200);
    });

    it("returns json when Accept includes fhir+json", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        headers: { Accept: "text/html, application/fhir+json" },
      });
      expect(res.status).toBe(200);
    });

    it("returns 406 for xml Accept on write endpoint", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Accept: "application/xml",
        },
        body: JSON.stringify({ resourceType: "Patient", name: [{ family: "Test" }] }),
      });
      expect(res.status).toBe(406);
    });

    it("allows wildcard Accept header", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        headers: { Accept: "*/*" },
      });
      expect(res.status).toBe(200);
    });

    it("allows Accept header with application/json", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        headers: { Accept: "application/json" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("system history", () => {
    it("returns 404 when history-system not in CapabilityStatement", async () => {
      const noHistoryConfig = {
        resourceType: "CapabilityStatement" as const,
        kind: "instance" as const,
        status: "active" as const,
        date: "2026-08-31",
        fhirVersion: "5.0.0",
        format: ["json"],
        rest: [{
          mode: "server",
          resource: [{
            type: "Patient",
            interaction: [{ code: "read" }],
          }],
          interaction: [{ code: "transaction" }, { code: "batch" }],
        }],
      };
      const noHistoryServer = await createTestServerWithCapability(noHistoryConfig);
      try {
        const res = await fetch(`${noHistoryServer.baseUrl}/_history`);
        expect(res.status).toBe(404);
      } finally {
        noHistoryServer.stop();
      }
    });
  });
});
