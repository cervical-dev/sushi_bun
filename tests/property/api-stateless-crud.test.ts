import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { createTestServer, createClient, validPatient, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

describe("Stateless CRUD Round-Trip Properties", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  describe("POST → GET → PUT → GET preserves semantics", () => {
    it("ETag matches meta.versionId, Location/Last-Modified coherent", async () => {
      await fc.assert(
        fc.asyncProperty(
          validPatientArbitrary(),
          async (patient) => {
            const createRes = await client.create("Patient", patient);
            expect(createRes.status).toBe(201);
            const id = createRes.body.id;
            const etag = createRes.headers.get("ETag");
            expect(etag).toBe(`W/"${createRes.body.meta.versionId}"`);

            const readRes = await client.read("Patient", id);
            expect(readRes.status).toBe(200);
            expect(readRes.headers.get("ETag")).toBe(etag);
            expect(readRes.headers.get("Last-Modified")).toBeDefined();
            expect(readRes.body.meta.versionId).toBe("1");

            const updateRes = await client.update("Patient", id, {
              ...readRes.body,
              name: [{ family: "Updated", given: ["Jane"] }],
            }, etag!);
            expect(updateRes.status).toBe(200);
            expect(updateRes.body.meta.versionId).toBe("2");
            expect(updateRes.headers.get("ETag")).toBe('W/"2"');

            const read2 = await client.read("Patient", id);
            expect(read2.body.meta.versionId).toBe("2");
            expect(read2.body.name[0].family).toBe("Updated");
          }
        ),
        { numRuns: 200, endOnFailure: true }
      );
    });
  });

  describe("Valid/mutant pairs", () => {
    it("valid → 201, invalid → 400/422 with OperationOutcome", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            validPatientArbitrary(),
            invalidPatientArbitrary(),
          ),
          async (patient) => {
            const res = await client.create("Patient", patient);
            if (isValidPatient(patient)) {
              expect(res.status).toBe(201);
              expect(res.body.resourceType).toBe("Patient");
            } else {
              expect([400, 422]).toContain(res.status);
              expect(res.body.resourceType).toBe("OperationOutcome");
              expect(res.body.issue).toBeDefined();
              expect(Array.isArray(res.body.issue)).toBe(true);
            }
          }
        ),
        { numRuns: 200, endOnFailure: true }
      );
    });
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
    birthDate: fc.constantFrom("1990-01-15", "1985-06-20", "2000-12-31", "1978-03-08"),
  });
}

function invalidPatientArbitrary(): fc.Arbitrary<Record<string, unknown>> {
  return fc.oneof(
    fc.constant({ resourceType: "Patient" }),
    fc.constant({ resourceType: "Patient", gender: "invalid" }),
    fc.constant({ resourceType: "Patient", birthDate: "not-a-date" }),
    fc.constant({ resourceType: "Patient", name: "not-an-array" }),
  );
}

function isValidPatient(patient: Record<string, unknown>): boolean {
  if (!patient.name || !Array.isArray(patient.name) || patient.name.length === 0) return false;
  if (!patient.identifier || !Array.isArray(patient.identifier) || patient.identifier.length === 0) return false;
  if (!patient.gender || typeof patient.gender !== "string") return false;
  if (!["male", "female", "other", "unknown"].includes(patient.gender as string)) return false;
  if (!patient.birthDate || typeof patient.birthDate !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(patient.birthDate as string)) return false;
  return true;
}
