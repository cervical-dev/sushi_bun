import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, type TestServer } from "../helpers.ts";

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
    const body = await res.json();
    expect(body.resourceType).toBe("CapabilityStatement");
  });

  it("returns 200 for Patient read (supported)", async () => {
    const created = server.store.create("Patient", {
      resourceType: "Patient",
      name: [{ family: "Smith", given: ["John"] }],
    });

    const res = await fetch(`${server.baseUrl}/Patient/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Patient");
    expect(res.headers.get("ETag")).toBe(`W/"1"`);
  });

  it("returns 200 for Patient search (supported)", async () => {
    server.store.create("Patient", { resourceType: "Patient", name: [{ family: "Jones" }] });

    const res = await fetch(`${server.baseUrl}/Patient?name=Jones`);
    expect(res.status).toBe(200);
    const body = await res.json();
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
        name: [{ family: "Updated" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
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
    const body = await res.json();
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
    const body = await res.json();
    expect(body.resourceType).toBe("OperationOutcome");
  });
});
