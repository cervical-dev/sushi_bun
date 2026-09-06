import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";
import { validatePrimitive } from "../../src/fhir/type-checker/primitive-checker.ts";
import type { StructureDefinitionElement } from "../../src/fhir/types.ts";

const PRIMITIVE_TYPE_CODES = [
  "string", "boolean", "integer", "decimal", "uri", "url", "canonical",
  "id", "date", "dateTime", "instant", "time", "positiveInt", "unsignedInt",
  "base64Binary", "oid", "uuid", "code",
] as const;

function elementWithType(typeCode: string): StructureDefinitionElement {
  return {
    id: `test.${typeCode}`,
    path: `Resource.${typeCode}`,
    type: [{ code: typeCode }],
  };
}

describe("Primitive Checker — Property-Based Tests", () => {
  describe("Robustness", () => {
    it("never throws for any primitive type code + any JSON value", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...PRIMITIVE_TYPE_CODES),
          fc.jsonValue(),
          (typeCode, value) => {
            const el = elementWithType(typeCode);
            expect(() => validatePrimitive(value, el)).not.toThrow();
          }
        ),
        { numRuns: 10000, endOnFailure: true }
      );
    });

    it("never throws for unknown type codes", () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => !PRIMITIVE_TYPE_CODES.includes(s as any)),
          fc.jsonValue(),
          (typeCode, value) => {
            const el = elementWithType(typeCode);
            expect(() => validatePrimitive(value, el)).not.toThrow();
          }
        ),
        { numRuns: 5000, endOnFailure: true }
      );
    });

    it("never throws when element has no type constraint", () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          const el: StructureDefinitionElement = {
            id: "test.noType",
            path: "Resource.noType",
          };
          expect(() => validatePrimitive(value, el)).not.toThrow();
        }),
        { numRuns: 5000, endOnFailure: true }
      );
    });
  });

  describe("Valid values pass", () => {
    const validPrimitives: [string, fc.Arbitrary<unknown>][] = [
      ["string", fc.string()],
      ["boolean", fc.boolean()],
      ["integer", fc.integer()],
      ["decimal", fc.double({ noNaN: true })],
      ["uri", fc.constantFrom("http://example.com", "https://hl7.org/fhir", "urn:oid:2.16.840.1.113883.4.642", "ValueSet/123")],
      ["url", fc.constantFrom("http://example.com", "https://hl7.org/fhir")],
      ["canonical", fc.constantFrom("http://hl7.org/fhir/StructureDefinition/Patient", "http://hl7.org/fhir/ValueSet/vs|4.0.1")],
      ["id", fc.stringMatching(/^[A-Za-z0-9\-\.]{1,64}$/)],
      ["date", fc.constantFrom("2024", "2024-01", "2024-01-15")],
      ["dateTime", fc.constantFrom("2024-01-15", "2024-01-15T10:30:00Z", "2024-01-15T10:30:00+05:30")],
      ["instant", fc.constantFrom("2024-01-15T10:30:00Z", "2024-01-15T10:30:00+05:30")],
      ["time", fc.constantFrom("10:30", "10:30:00", "10:30:00.123")],
      ["positiveInt", fc.integer({ min: 1 })],
      ["unsignedInt", fc.integer({ min: 0 })],
      ["base64Binary", fc.constantFrom("SGVsbG8=", "VGVzdA==", "AQID")],
      ["oid", fc.constantFrom("2.16.840.1.113883.4.642.1", "1.2.3.4")],
      ["uuid", fc.constantFrom("urn:uuid:12345678-1234-1234-1234-123456789012")],
      ["code", fc.constantFrom("final", "active", "male", "female")],
    ];

    for (const [typeCode, arbitrary] of validPrimitives) {
      it(`passes for valid ${typeCode} values`, () => {
        fc.assert(
          fc.property(arbitrary, (value) => {
            const el = elementWithType(typeCode);
            const issues = validatePrimitive(value, el);
            expect(issues).toHaveLength(0);
          }),
          { numRuns: 500, endOnFailure: true }
        );
      });
    }
  });

  describe("Wrong type produces error", () => {
    it("integer type rejects non-numbers", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.boolean(), fc.constant(null), fc.array(fc.string()), fc.object()),
          (value) => {
            const el = elementWithType("integer");
            const issues = validatePrimitive(value, el);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]!.code).toBe("invalid-type");
          }
        ),
        { numRuns: 500, endOnFailure: true }
      );
    });

    it("boolean type rejects non-booleans", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.array(fc.boolean()), fc.object()),
          (value) => {
            const el = elementWithType("boolean");
            const issues = validatePrimitive(value, el);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]!.code).toBe("invalid-type");
          }
        ),
        { numRuns: 500, endOnFailure: true }
      );
    });

    it("string type rejects non-strings", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string()), fc.object()),
          (value) => {
            const el = elementWithType("string");
            const issues = validatePrimitive(value, el);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]!.code).toBe("invalid-type");
          }
        ),
        { numRuns: 500, endOnFailure: true }
      );
    });
  });

  describe("Null produces exactly one error", () => {
    it("null produces exactly 1 error for each type code", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...PRIMITIVE_TYPE_CODES),
          (typeCode) => {
            const el = elementWithType(typeCode);
            const issues = validatePrimitive(null, el);
            expect(issues).toHaveLength(1);
            expect(issues[0]!.severity).toBe("error");
          }
        ),
        { numRuns: 200, endOnFailure: true }
      );
    });
  });

  describe("Deterministic output", () => {
    it("validatePrimitive is deterministic for any value", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...PRIMITIVE_TYPE_CODES),
          fc.jsonValue(),
          (typeCode, value) => {
            const el = elementWithType(typeCode);
            const result1 = validatePrimitive(value, el);
            const result2 = validatePrimitive(value, el);
            expect(result1).toEqual(result2);
          }
        ),
        { numRuns: 5000, endOnFailure: true }
      );
    });
  });
});
