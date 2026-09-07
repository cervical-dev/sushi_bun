import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { createTestServer, createClient, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

describe("Search Law Properties", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  it("gender=male returns exact seeded subset", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            gender: fc.constantFrom("male", "female"),
            family: fc.stringMatching(/^[A-Z][a-z]{2,4}$/),
          }),
          { minLength: 3, maxLength: 10 }
        ),
        async (patients) => {
          const tag = `SEARCH-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          for (const p of patients) {
            await client.create("Patient", {
              identifier: [{ system: "http://example.org/tag", value: tag }],
              name: [{ family: p.family, given: ["Test"] }],
              gender: p.gender,
              birthDate: "1990-01-01",
            });
          }

          const res = await client.search("Patient", { gender: "male", identifier: `http://example.org/tag|${tag}` });
          expect(res.status).toBe(200);
          const expected = patients.filter(p => p.gender === "male").length;
          expect(res.body.total).toBe(expected);
          expect(res.body.entry.length).toBe(expected);
        }
      ),
      { numRuns: 50, endOnFailure: true }
    );
  });

  it("_count/_offset pages concatenate to full set with no overlap", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 8 }),
        fc.integer({ min: 1, max: 3 }),
        async (count, pageSize) => {
          const tag = `PAGE-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          for (let i = 0; i < count; i++) {
            await client.create("Patient", {
              identifier: [{ system: "http://example.org/tag", value: tag }],
              name: [{ family: `Page${i}`, given: ["Test"] }],
              gender: "male",
              birthDate: "1990-01-01",
            });
          }

          const allIds = new Set<string>();
          let offset = 0;
          let page = 0;
          while (true) {
            const res = await client.search("Patient", {
              _count: String(pageSize),
              _offset: String(offset),
              identifier: `http://example.org/tag|${tag}`,
            });
            expect(res.status).toBe(200);
            const entries = res.body.entry || [];
            for (const e of entries) {
              allIds.add(e.resource.id);
            }
            offset += pageSize;
            page++;
            if (entries.length < pageSize) break;
            if (page > 20) break;
          }
          expect(allIds.size).toBe(count);
        }
      ),
      { numRuns: 30, endOnFailure: true }
    );
  });

  it("GET and POST search return same results", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom("male", "female"),
          { minLength: 2, maxLength: 6 }
        ),
        async (genders) => {
          const tag = `GETPOST-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          for (const g of genders) {
            await client.create("Patient", {
              identifier: [{ system: "http://example.org/tag", value: tag }],
              name: [{ family: "Test", given: ["Test"] }],
              gender: g,
              birthDate: "1990-01-01",
            });
          }

          const getRes = await client.search("Patient", { gender: "male", identifier: `http://example.org/tag|${tag}` });
          const postRes = await fetch(`${server.baseUrl}/Patient/_search`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `gender=male&identifier=http://example.org/tag|${tag}`,
          });
          const postBody = await postRes.json() as any;

          expect(getRes.body.total).toBe(postBody.total);
          expect(getRes.body.entry.length).toBe(postBody.entry.length);
        }
      ),
      { numRuns: 30, endOnFailure: true }
    );
  });
});
