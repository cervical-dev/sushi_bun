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
              resource: samplePatient({ name: [{ family: "Batch1", given: ["Patient1"] }] }),
            },
            {
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "Batch2", given: ["Patient2"] }] }),
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
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
      const body = await res.json() as Record<string, any>;
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
              resource: samplePatient({ name: [{ family: "Tx1", given: ["Patient1"] }] }),
            },
            {
              fullUrl: "urn:uuid:patient-2",
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "Tx2", given: ["Patient2"] }] }),
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
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
              resource: samplePatient({ name: [{ family: "ShouldBeRolledBack", given: ["Rollback"] }] }),
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
      const body = await res.json() as Record<string, any>;
      expect(body.type).toBe("transaction-response");

      expect(body.entry.length).toBe(2);

      const goodResult = body.entry[0].response;
      const badResult = body.entry[1].response;

      expect(goodResult.status).toBe("422");
      expect(badResult.status).toBe("404");

      const searchRes = await fetch(`${server.baseUrl}/Patient?name=ShouldBeRolledBack`);
      const searchBody = await searchRes.json() as Record<string, any>;
      expect(searchBody.total).toBe(0);
    });

    it("processes transaction entries in correct order", async () => {
      const created = server.store.create("Patient", samplePatient({ name: [{ family: "ToDelete", given: ["Order"] }] }));

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "transaction",
          entry: [
            {
              request: { method: "GET", url: `Patient/${created.id}` },
            },
            {
              fullUrl: "urn:uuid:new-patient",
              request: { method: "POST", url: "Patient" },
              resource: samplePatient({ name: [{ family: "CreatedAfter", given: ["Order"] }] }),
            },
            {
              request: { method: "DELETE", url: `Patient/${created.id}` },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.type).toBe("transaction-response");
      expect(body.entry.length).toBe(3);

      const statuses = body.entry.map((e: any) => e.response.status);

      expect(statuses[0]).toBe("410");
      expect(statuses[1]).toBe("201");
      expect(statuses[2]).toBe("204");
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
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("404");
    });

    it("accepts empty batch bundle", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.type).toBe("batch-response");
      expect(body.entry.length).toBe(0);
    });

    it("accepts empty transaction bundle", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "transaction",
          entry: [],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.type).toBe("transaction-response");
      expect(body.entry.length).toBe(0);
    });

    it("rejects entry missing request", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              resource: samplePatient(),
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("rejects POST entry missing resource", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "POST", url: "Patient" },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("rejects PUT entry without id in URL", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "PUT", url: "Patient" },
              resource: samplePatient(),
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("rejects PUT entry missing resource", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "PUT", url: `Patient/${created.id}` },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("rejects DELETE entry without id", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "DELETE", url: "Patient" },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("rejects unsupported HTTP method", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "LINK", url: "Patient/123" },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("rejects GET entry without id in URL", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "GET", url: "Patient" },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("does not validate resource payload on DELETE entries", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "DELETE", url: `Patient/${created.id}` },
              resource: { resourceType: "Patient" },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("204");
    });

    it("reports 405 for POST to resource without create interaction", async () => {
      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "POST", url: "Observation" },
              resource: { resourceType: "Observation", status: "final", code: { coding: [] } },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("405");
    });
  });

  describe("batch PATCH", () => {
    it("patches a patient in a batch", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.id}` },
            resource: [{ op: "replace", path: "/gender", value: "female" }],
          }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("200");
      expect(body.entry[0].resource.gender).toBe("female");
    });

    it("returns 422 when batch PATCH changes resourceType", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.id}` },
            resource: [{ op: "replace", path: "/resourceType", value: "Observation" }],
          }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("422");
    });

    it("returns 410 when batch PATCH on deleted resource", async () => {
      const created = server.store.create("Patient", samplePatient());
      server.store.softDelete("Patient", created.id!);

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.id}` },
            resource: [{ op: "replace", path: "/gender", value: "female" }],
          }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("410");
    });

    it("returns precondition-failed when batch PATCH test op fails", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.id}` },
            resource: [{ op: "test", path: "/gender", value: "wrong" }],
          }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("422");
      const issue = body.entry[0].response.outcome.issue[0];
      expect(issue.code).toBe("precondition-failed");
    });
  });
});
