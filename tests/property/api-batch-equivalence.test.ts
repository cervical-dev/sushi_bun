import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { createTestServer, createClient, validPatient, validObservation, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

describe("Batch/Transaction Equivalence Properties", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  it("batch[N creates] == N individual POSTs as multiset", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            family: fc.stringMatching(/^[A-Z][a-z]{2,4}$/),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (patients) => {
          const tag = `BATCH-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const entries = patients.map(p => ({
            resource: validPatient({ name: [{ family: p.family, given: ["Batch"] }], identifier: [{ system: "http://example.org/tag", value: tag }] }),
            request: { method: "POST" as const, url: "Patient" },
          }));

          const batchRes = await fetch(`${server.baseUrl}/`, {
            method: "POST",
            headers: { "Content-Type": "application/fhir+json" },
            body: JSON.stringify({ resourceType: "Bundle", type: "batch", entry: entries }),
          });
          const batchBody = await batchRes.json() as any;
          expect(batchBody.entry.length).toBe(patients.length);
          for (const e of batchBody.entry) {
            expect(e.response.status).toBe("201");
          }

          const searchRes = await client.search("Patient", { identifier: `http://example.org/tag|${tag}` });
          expect(searchRes.body.total).toBe(patients.length);
        }
      ),
      { numRuns: 30, endOnFailure: true }
    );
  });

  it("transaction[1 good + 1 bad] → all 4xx + tag search == 0 (atomicity)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          goodFamily: fc.stringMatching(/^[A-Z][a-z]{2,4}$/),
        }),
        async ({ goodFamily }) => {
          const tag = `TXN-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const entries = [
            {
              resource: validPatient({ name: [{ family: goodFamily, given: ["Txn"] }], identifier: [{ system: "http://example.org/tag", value: tag }] }),
              request: { method: "POST" as const, url: "Patient" },
            },
            {
              resource: { resourceType: "Patient" },
              request: { method: "POST" as const, url: "Patient" },
            },
          ];

          const txnRes = await fetch(`${server.baseUrl}/`, {
            method: "POST",
            headers: { "Content-Type": "application/fhir+json" },
            body: JSON.stringify({ resourceType: "Bundle", type: "transaction", entry: entries }),
          });
          const txnBody = await txnRes.json() as any;
          for (const e of txnBody.entry) {
            expect(Number(e.response.status)).toBeGreaterThanOrEqual(400);
          }

          const searchRes = await client.search("Patient", { identifier: `http://example.org/tag|${tag}` });
          expect(searchRes.body.total).toBe(0);
        }
      ),
      { numRuns: 30, endOnFailure: true }
    );
  });
});
