import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, type TestServer } from "../helpers.ts";

describe("Metadata endpoint", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
  });

  afterAll(() => {
    server.stop();
  });

  it("returns the capability statement", async () => {
    const res = await fetch(`${server.baseUrl}/metadata`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.resourceType).toBe("CapabilityStatement");
    expect(body.fhirVersion).toBe("5.0.0");
    expect(body.kind).toBe("instance");
  });

  it("includes Patient resource in capability", async () => {
    const res = await fetch(`${server.baseUrl}/metadata`);
    const body = await res.json();

    const patientResource = body.rest[0].resource.find((r: { type: string }) => r.type === "Patient");
    expect(patientResource).toBeDefined();
    expect(patientResource.interaction.some((i: { code: string }) => i.code === "read")).toBe(true);
    expect(patientResource.interaction.some((i: { code: string }) => i.code === "search-type")).toBe(true);
    expect(patientResource.interaction.some((i: { code: string }) => i.code === "create")).toBe(true);
  });

  it("includes search parameters for Patient", async () => {
    const res = await fetch(`${server.baseUrl}/metadata`);
    const body = await res.json();

    const patientResource = body.rest[0].resource.find((r: { type: string }) => r.type === "Patient");
    expect(patientResource.searchParam.length).toBeGreaterThan(0);

    const nameParam = patientResource.searchParam.find((p: { name: string }) => p.name === "name");
    expect(nameParam).toBeDefined();
    expect(nameParam.type).toBe("string");
  });

  it("sets correct content type header", async () => {
    const res = await fetch(`${server.baseUrl}/metadata`);
    expect(res.headers.get("Content-Type")).toBe("application/fhir+json");
  });

  it("sets cache control header", async () => {
    const res = await fetch(`${server.baseUrl}/metadata`);
    expect(res.headers.get("Cache-Control")).toContain("max-age");
  });
});
