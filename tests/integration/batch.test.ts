import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, samplePatient, type TestServer } from "../helpers.ts";

describe("Batch and Transaction operations", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
  });

  afterAll(() => {
    server.stop();
  });

  describe("batch", () => {
    it("processes a batch with multiple creates", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "Batch1" }] }),
            },
            {
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "Batch2" }] }),
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resourceType).toBe("Bundle");
      expect(body.type).toBe("batch-response");
      expect(body.entry.length).toBe(2);
      expect(body.entry[0].response.status).toBe("201");
      expect(body.entry[1].response.status).toBe("201");
    });

    it("processes a batch with mixed operations", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "GET", url: `Patient/${created.id}` },
            },
            {
              request: { method: "DELETE", url: `Patient/${created.id}` },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entry[0].response.status).toBe("200");
      expect(body.entry[1].response.status).toBe("204");
    });
  });

  describe("transaction", () => {
    it("processes a transaction with creates", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "transaction",
          entry: [
            {
              fullUrl: "urn:uuid:patient-1",
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "Tx1" }] }),
            },
            {
              fullUrl: "urn:uuid:patient-2",
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "Tx2" }] }),
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.type).toBe("transaction-response");
      expect(body.entry.length).toBe(2);
      expect(body.entry[0].response.status).toBe("201");
      expect(body.entry[1].response.status).toBe("201");
    });

    it("rolls back all entries when one fails in a transaction", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "transaction",
          entry: [
            {
              fullUrl: "urn:uuid:good-patient",
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "ShouldBeRolledBack" }] }),
            },
            {
              fullUrl: "urn:uuid:bad-entry",
              request: { method: "POST", url: "Encounter" },
              resource: { resourceType: "Encounter", status: "planned" },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.type).toBe("transaction-response");

      expect(body.entry.length).toBe(2);

      const goodResult = body.entry[0].response;
      const badResult = body.entry[1].response;

      expect(goodResult.status).toBe("422");
      expect(badResult.status).toBe("404");

      const searchRes = await fetch(`${server.baseUrl}/Patient?name=ShouldBeRolledBack`);
      const searchBody = await searchRes.json();
      expect(searchBody.total).toBe(0);
    });
  });

  describe("error handling", () => {
    it("rejects non-bundle body", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({ resourceType: "Patient" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects unsupported bundle type", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "document",
          entry: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("reports errors for unsupported resource types in batch", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "POST", url: "Encounter" },
              resource: { resourceType: "Encounter", status: "planned" },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entry[0].response.status).toBe("404");
    });
  });
});
