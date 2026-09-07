import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { createTestServer, createClient, validPatient, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

describe("Header/Capability Fuzz Properties", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  it("never returns 500 on any If-Match value", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant('W/"1"'),
          fc.constant('W/"999"'),
          fc.constant("garbage"),
        ),
        async (ifMatch) => {
          const createRes = await client.create("Patient", validPatient());
          const id = createRes.body.id;

          const res = await client.update("Patient", id, {
            ...createRes.body,
            name: [{ family: "Fuzz", given: ["Test"] }],
          }, ifMatch);

          expect(res.status).toBeLessThan(500);
        }
      ),
      { numRuns: 100, endOnFailure: true }
    );
  });

  it("never returns 500 on any Content-Type", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant("application/fhir+json"),
          fc.constant("application/json"),
          fc.constant("text/plain"),
          fc.constant(""),
        ),
        async (contentType) => {
          const createRes = await client.create("Patient", validPatient());
          const id = createRes.body.id;

          const res = await fetch(`${server.baseUrl}/Patient/${id}`, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: JSON.stringify({ resourceType: "Patient", id, name: [{ family: "Fuzz" }] }),
          });

          expect(res.status).toBeLessThan(500);
        }
      ),
      { numRuns: 100, endOnFailure: true }
    );
  });

  it("Accept: application/xml → 406 on any endpoint", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("/Patient", "/metadata"),
        async (path) => {
          const res = await fetch(`${server.baseUrl}${path}`, {
            headers: { Accept: "application/xml" },
          });

          expect(res.status).toBe(406);
          const body = await res.json() as any;
          expect(body.resourceType).toBe("OperationOutcome");
        }
      ),
      { numRuns: 50, endOnFailure: true }
    );
  });

  it("unsupported resourceType → 404", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("Condition", "Encounter", "Procedure"),
        async (resourceType) => {
          const res = await fetch(`${server.baseUrl}/${resourceType}`);
          expect(res.status).toBe(404);
        }
      ),
      { numRuns: 30, endOnFailure: true }
    );
  });

  it("$validate(valid) has 0 errors iff POST → 201", async () => {
    await fc.assert(
      fc.asyncProperty(
        validPatientArbitrary(),
        async (patient) => {
          const postRes = await client.create("Patient", patient);
          const validateRes = await client.validate("Patient", patient);

          if (postRes.status === 201) {
            expect(validateRes.status).toBe(200);
            const errors = (validateRes.body.issue || []).filter((i: any) => i.severity === "error" || i.severity === "fatal");
            expect(errors.length).toBe(0);
          } else {
            expect(validateRes.status).toBe(200);
            expect(validateRes.body.issue?.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100, endOnFailure: true }
    );
  });
});

function validPatientArbitrary(): fc.Arbitrary<Record<string, unknown>> {
  return fc.record({
    resourceType: fc.constant("Patient"),
    identifier: fc.array(
      fc.record({
        system: fc.constant("http://example.org/mrn"),
        value: fc.stringMatching(/^[0-9a-f]{4,8}$/),
      }),
      { minLength: 1, maxLength: 2 }
    ),
    name: fc.array(
      fc.record({
        family: fc.stringMatching(/^[A-Z][a-z]+$/),
        given: fc.array(fc.stringMatching(/^[A-Z][a-z]+$/), { minLength: 1, maxLength: 2 }),
      }),
      { minLength: 1, maxLength: 2 }
    ),
    gender: fc.constantFrom("male", "female", "other", "unknown"),
    birthDate: fc.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
}
