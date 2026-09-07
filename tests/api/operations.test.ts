import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestServer, createClient, validPatient, type TestServer, type FhirClient } from "../support/index.ts";

describe("Operations", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  describe("$everything", () => {
    it("returns all resources of a type", async () => {
      server.store.create("Patient", {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "everything-1" }],
        name: [{ family: "Everything1", given: ["Test"] }],
        gender: "male",
        birthDate: "1990-01-01",
      });
      server.store.create("Patient", {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "everything-2" }],
        name: [{ family: "Everything2", given: ["Test"] }],
        gender: "male",
        birthDate: "1990-01-01",
      });

      const res = await fetch(`${server.baseUrl}/Patient/$everything`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("Bundle");
      expect(body.type).toBe("searchset");
      expect(body.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe("$validate", () => {
    it("returns validation outcome", async () => {
      const res = await client.validate("Patient", validPatient());

      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe("OperationOutcome");
      expect(res.body.issue[0].severity).toBe("information");
    });
  });

  describe("unknown operations", () => {
    it("returns 404 for unknown operations", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/$unknown`, {
        method: "POST",
      });

      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
    });
  });

  describe("instance operations", () => {
    it("routes instance validate operation", async () => {
      const created = await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.body.id}/$validate`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(validPatient()),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
    });
  });

  describe("system operations", () => {
    it("routes system-level operation", async () => {
      const res = await fetch(`${server.baseUrl}/$validate`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(validPatient()),
      });

      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
    });
  });
});
