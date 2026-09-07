import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";
import { validateResource } from "../../src/fhir/validator.ts";
import type { StructureDefinition, StructureDefinitionElement } from "../../src/fhir/types.ts";
import { patientSD } from "../support/builders.ts";

const myPatientSD = patientSD() as StructureDefinition;

function validPatientArbitrary(): fc.Arbitrary<Record<string, unknown>> {
  return fc.record({
    resourceType: fc.constant("Patient"),
    identifier: fc.array(
      fc.record({
        system: fc.constant("http://example.org/mrn"),
        value: fc.stringMatching(/^[0-9a-f]{4,8}$/),
      }),
      { minLength: 1, maxLength: 3 }
    ),
    name: fc.array(
      fc.record({
        family: fc.stringMatching(/^[A-Z][a-z]+$/),
        given: fc.array(fc.stringMatching(/^[A-Z][a-z]+$/), { minLength: 1, maxLength: 2 }),
      }),
      { minLength: 1, maxLength: 3 }
    ),
    gender: fc.constantFrom("male", "female", "other", "unknown"),
    birthDate: fc.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    telecom: fc.option(
      fc.array(
        fc.record({
          system: fc.constant("phone"),
          value: fc.stringMatching(/^\d{10}$/),
        }),
        { nil: undefined }
      ),
    ),
    address: fc.option(
      fc.array(
        fc.record({
          line: fc.array(fc.constant("123 Main St"), { minLength: 1, maxLength: 1 }),
          city: fc.constant("Springfield"),
          state: fc.constant("IL"),
          postalCode: fc.stringMatching(/^\d{5}$/),
        }),
        { nil: undefined }
      ),
    ),
  });
}

type FieldRemover = {
  field: string;
  remove: (r: Record<string, unknown>) => Record<string, unknown>;
};

const mutationStrategies: FieldRemover[] = [
  { field: "identifier", remove: r => { const c = { ...r }; delete c.identifier; return c; } },
  { field: "identifier[0].system", remove: r => ({ ...r, identifier: [{ value: (r.identifier as any)?.[0]?.value }] }) },
  { field: "name", remove: r => { const c = { ...r }; delete c.name; return c; } },
  { field: "name[0].family", remove: r => ({ ...r, name: [{ given: (r.name as any)?.[0]?.given }] }) },
  { field: "gender", remove: r => { const c = { ...r }; delete c.gender; return c; } },
  { field: "birthDate", remove: r => { const c = { ...r }; delete c.birthDate; return c; } },
];

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

describe("Full Validation Pipeline — Property-Based Tests", () => {
  describe("Robustness on arbitrary input", () => {
    it("never throws on arbitrary JSON input with any SD", () => {
      fc.assert(
        fc.property(
          fc.jsonValue(),
          (value) => {
            expect(() => {
              const resource = typeof value === "object" && value !== null && !Array.isArray(value)
                ? { ...value as Record<string, unknown>, resourceType: "Patient" }
                : { resourceType: "Patient" };
              validateResource(resource, myPatientSD);
            }).not.toThrow();
          }
        ),
        { numRuns: 10000, endOnFailure: true }
      );
    });

    it("never throws when resource has extra unknown keys", () => {
      fc.assert(
        fc.property(
          validPatientArbitrary(),
          fc.dictionary(fc.string(), fc.jsonValue()),
          (patient, extra) => {
            const withExtra = stripUndefined({ ...patient, ...extra });
            expect(() => validateResource(withExtra, myPatientSD)).not.toThrow();
          }
        ),
        { numRuns: 1000, endOnFailure: true }
      );
    });
  });

  describe("Valid patients pass validation", () => {
    it("all generated conformant patients pass validation", () => {
      fc.assert(
        fc.property(validPatientArbitrary(), (patient) => {
          const result = validateResource(stripUndefined(patient), myPatientSD);
          expect(result.valid).toBe(true);
          expect(result.issues).toHaveLength(0);
        }),
        { numRuns: 2000, endOnFailure: true }
      );
    });
  });

  describe("Breaking one required field produces errors", () => {
    it("breaking exactly 1 required field always fails with correct location", () => {
      fc.assert(
        fc.property(
          validPatientArbitrary(),
          fc.constantFrom(...mutationStrategies),
          (validResource, mutation) => {
            const mutated = stripUndefined(mutation.remove(validResource));
            const result = validateResource(mutated, myPatientSD);
            expect(result.valid).toBe(false);
            expect(result.issues.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 1000, endOnFailure: true }
      );
    });
  });

  describe("Deterministic output", () => {
    it("validateResource is deterministic", () => {
      fc.assert(
        fc.property(
          fc.oneof(validPatientArbitrary(), fc.jsonValue().map(v => {
            const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
            return stripUndefined({ resourceType: "Patient", ...r });
          })),
          (resource) => {
            const result1 = validateResource(resource, myPatientSD);
            const result2 = validateResource(resource, myPatientSD);
            expect(result1.valid).toBe(result2.valid);
            expect(result1.issues).toEqual(result2.issues);
          }
        ),
        { numRuns: 2000, endOnFailure: true }
      );
    });
  });

  describe("Minimum error count for empty resource", () => {
    it("empty resource produces at least 4 errors (identifier, name, gender, birthDate min=1)", () => {
      const result = validateResource({ resourceType: "Patient" }, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Wrong resourceType produces error", () => {
    it("wrong resourceType always produces invalid-resource-type error", () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => s !== "Patient"),
          (wrongType) => {
            const resource = { resourceType: wrongType };
            const result = validateResource(resource, myPatientSD);
            expect(result.valid).toBe(false);
            expect(result.issues.length).toBeGreaterThanOrEqual(1);
            expect(result.issues[0]!.code).toBe("invalid-resource-type");
          }
        ),
        { numRuns: 500, endOnFailure: true }
      );
    });
  });
});
