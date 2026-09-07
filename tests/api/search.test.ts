import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestServer, createClient, validPatient, validObservation, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

describe("Search operations", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  it("returns all patients with no filter", async () => {
    await client.create("Patient", validPatient({ name: [{ family: "Alpha", given: ["Alice"] }], gender: "female" }));
    await client.create("Patient", validPatient({ name: [{ family: "Beta", given: ["Bob"] }], gender: "male" }));

    const res = await client.search("Patient");
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe("Bundle");
    expect(res.body.type).toBe("searchset");
    expect(res.body.total).toBe(2);
    expect(res.body.entry.length).toBe(2);
  });

  it("filters by name", async () => {
    await client.create("Patient", validPatient({ name: [{ family: "Alpha", given: ["Alice"] }] }));
    await client.create("Patient", validPatient({ name: [{ family: "Beta", given: ["Bob"] }] }));

    const res = await client.search("Patient", { name: "Alpha" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.entry[0].resource.name[0].family).toBe("Alpha");
  });

  it("filters by gender", async () => {
    await client.create("Patient", validPatient({ gender: "male" }));
    await client.create("Patient", validPatient({ gender: "female" }));

    const res = await client.search("Patient", { gender: "male" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("returns pagination links", async () => {
    await client.create("Patient", validPatient());
    await client.create("Patient", validPatient());
    await client.create("Patient", validPatient());

    const res = await client.search("Patient", { _count: "2" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.entry.length).toBe(2);
    expect(res.body.link).toBeDefined();
    const nextLink = res.body.link.find((l: { relation: string }) => l.relation === "next");
    expect(nextLink).toBeDefined();
  });

  it("paginates with offset", async () => {
    await client.create("Patient", validPatient());
    await client.create("Patient", validPatient());
    await client.create("Patient", validPatient());

    const res = await client.search("Patient", { _count: "2", _offset: "2" });
    expect(res.status).toBe(200);
    expect(res.body.entry.length).toBe(1);
  });

  it("searches Observation by patient reference", async () => {
    const patient = server.store.create("Patient", {
      resourceType: "Patient",
      identifier: [{ system: "http://example.org/mrn", value: "obs-patient" }],
      name: [{ family: "ObsPatient", given: ["Test"] }],
      gender: "male",
      birthDate: "1990-01-01",
    });

    server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      subject: { reference: `Patient/${patient.id}` },
    });

    const res = await client.search("Observation", { patient: `Patient/${patient.id}` });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("searches Observation by code", async () => {
    server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      subject: { reference: "Patient/none" },
    });

    const res = await client.search("Observation", { code: "8867-4" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("searches Observation by status", async () => {
    server.store.create("Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      subject: { reference: "Patient/none" },
    });

    const res = await client.search("Observation", { status: "final" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("returns empty bundle for no matches", async () => {
    const res = await client.search("Patient", { name: "NonExistent" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.entry.length).toBe(0);
  });

  it("searches with comma-separated values using OR semantics", async () => {
    await client.create("Patient", validPatient({ name: [{ family: "Alpha", given: ["Alice"] }] }));
    await client.create("Patient", validPatient({ name: [{ family: "Beta", given: ["Bob"] }] }));
    await client.create("Patient", validPatient({ name: [{ family: "Gamma", given: ["Charlie"] }] }));

    const res = await client.search("Patient", { name: "Beta,Gamma" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const families = res.body.entry.map((e: any) => e.resource.name[0].family).sort();
    expect(families).toEqual(["Beta", "Gamma"]);
  });

  it("searches via POST with form-encoded body", async () => {
    await client.create("Patient", validPatient({ name: [{ family: "Alpha", given: ["Alice"] }] }));
    await client.create("Patient", validPatient({ name: [{ family: "Beta", given: ["Bob"] }] }));

    const res = await fetch(`${server.baseUrl}/Patient/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "name=Alpha",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.resourceType).toBe("Bundle");
    expect(body.type).toBe("searchset");
    expect(body.total).toBe(1);
  });
});
