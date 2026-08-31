import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, samplePatient, type TestServer } from "../helpers.ts";

describe("Operations", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
  });

  afterAll(() => {
    server.stop();
  });

  describe("$everything", () => {
    it("returns all resources of a type", async () => {
      server.store.create("Patient", samplePatient({ name: [{ family: "Everything1" }] }));
      server.store.create("Patient", samplePatient({ name: [{ family: "Everything2" }] }));

      const res = await fetch(`${server.baseUrl}/Patient/$everything`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resourceType).toBe("Bundle");
      expect(body.type).toBe("searchset");
      expect(body.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe("$validate", () => {
    it("returns validation outcome", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/$validate`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(samplePatient()),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resourceType).toBe("OperationOutcome");
      expect(body.issue[0].severity).toBe("information");
    });
  });

  describe("unknown operations", () => {
    it("returns 404 for unknown operations", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/$unknown`, {
        method: "POST",
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.resourceType).toBe("OperationOutcome");
    });
  });
});
