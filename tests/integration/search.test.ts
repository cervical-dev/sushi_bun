import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, samplePatient, type TestServer } from "../helpers.ts";

describe("Search operations", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");

    server.store.create("Patient", samplePatient({ name: [{ family: "Alpha", given: ["Alice"] }], gender: "female", birthDate: "1985-03-15" }));
    server.store.create("Patient", samplePatient({ name: [{ family: "Beta", given: ["Bob"] }], gender: "male", birthDate: "1990-07-22" }));
    server.store.create("Patient", samplePatient({ name: [{ family: "Gamma", given: ["Charlie"] }], gender: "male", birthDate: "1995-11-08" }));
  });

  afterAll(() => {
    server.stop();
  });

  it("returns all patients with no filter", async () => {
    const res = await fetch(`${server.baseUrl}/Patient`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Bundle");
    expect(body.type).toBe("searchset");
    expect(body.total).toBe(3);
    expect(body.entry.length).toBe(3);
  });

  it("filters by name", async () => {
    const res = await fetch(`${server.baseUrl}/Patient?name=Alpha`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.entry[0].resource.name[0].family).toBe("Alpha");
  });

  it("filters by gender", async () => {
    const res = await fetch(`${server.baseUrl}/Patient?gender=male`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
  });

  it("returns pagination links", async () => {
    const res = await fetch(`${server.baseUrl}/Patient?_count=2`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.entry.length).toBe(2);
    expect(body.link).toBeDefined();
    const nextLink = body.link.find((l: { relation: string }) => l.relation === "next");
    expect(nextLink).toBeDefined();
  });

  it("paginates with offset", async () => {
    const res = await fetch(`${server.baseUrl}/Patient?_count=2&_offset=2`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.length).toBe(1);
  });

  it("searches Observation by patient reference", async () => {
    const patient = server.store.create("Patient", samplePatient());

    server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      subject: { reference: `Patient/${patient.id}` },
    });

    const res = await fetch(`${server.baseUrl}/Observation?patient=Patient/${patient.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
  });

  it("searches Observation by code", async () => {
    server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    });

    const res = await fetch(`${server.baseUrl}/Observation?code=8867-4`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("searches Observation by status", async () => {
    server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "12345" }] },
    });

    const res = await fetch(`${server.baseUrl}/Observation?status=final`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("returns empty bundle for no matches", async () => {
    const res = await fetch(`${server.baseUrl}/Patient?name=NonExistent`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.entry.length).toBe(0);
  });
});
