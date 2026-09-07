import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestServer, createClient, validPatient, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

describe("Batch and Transaction operations", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
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
              resource: validPatient({ name: [{ family: "Batch1", given: ["Patient1"] }] }),
            },
            {
              request: { method: "POST", url: "Patient" },
              resource: validPatient({ name: [{ family: "Batch2", given: ["Patient2"] }] }),
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
      const created = await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "GET", url: `Patient/${created.body.id}` },
            },
            {
              request: { method: "DELETE", url: `Patient/${created.body.id}` },
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
              resource: validPatient({ name: [{ family: "Tx1", given: ["Patient1"] }] }),
            },
            {
              fullUrl: "urn:uuid:patient-2",
              request: { method: "POST", url: "Patient" },
              resource: validPatient({ name: [{ family: "Tx2", given: ["Patient2"] }] }),
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
              resource: validPatient({ name: [{ family: "ShouldBeRolledBack", given: ["Rollback"] }] }),
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

      const searchRes = await client.search("Patient", { name: "ShouldBeRolledBack" });
      expect(searchRes.body.total).toBe(0);
    });

    it("processes transaction entries in correct order", async () => {
      const created = await client.create("Patient", validPatient({ name: [{ family: "ToDelete", given: ["Order"] }] }));

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "transaction",
          entry: [
            {
              request: { method: "GET", url: `Patient/${created.body.id}` },
            },
            {
              fullUrl: "urn:uuid:new-patient",
              request: { method: "POST", url: "Patient" },
              resource: validPatient({ name: [{ family: "CreatedAfter", given: ["Order"] }] }),
            },
            {
              request: { method: "DELETE", url: `Patient/${created.body.id}` },
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
              resource: validPatient(),
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
              resource: validPatient(),
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("400");
    });

    it("rejects PUT entry missing resource", async () => {
      const created = await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "PUT", url: `Patient/${created.body.id}` },
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
      const created = await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [
            {
              request: { method: "DELETE", url: `Patient/${created.body.id}` },
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
      const created = await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.body.id}` },
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
      const created = await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.body.id}` },
            resource: [{ op: "replace", path: "/resourceType", value: "Observation" }],
          }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("422");
    });

    it("returns 410 when batch PATCH on deleted resource", async () => {
      const created = await client.create("Patient", validPatient());
      await client.delete("Patient", created.body.id);

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.body.id}` },
            resource: [{ op: "replace", path: "/gender", value: "female" }],
          }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("410");
      expect(body.entry[0].response.etag).toMatch(/^W\/"\d+"$/);
      expect(body.entry[0].response.outcome.issue[0].code).toBe("deleted");
    });

    it("returns precondition-failed when batch PATCH test op fails", async () => {
      const created = await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Bundle",
          type: "batch",
          entry: [{
            request: { method: "PATCH", url: `Patient/${created.body.id}` },
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
