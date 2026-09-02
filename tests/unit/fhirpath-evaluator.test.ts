import { describe, it, expect } from "bun:test";
import { evaluate } from "../../src/fhir/fhirpath/evaluator.ts";
import type { AstNode } from "../../src/fhir/fhirpath/parser.ts";
import { parse } from "../../src/fhir/fhirpath/parser.ts";

function evalExpr(expression: string, resource: Record<string, unknown>): unknown {
  const ast = parse(expression);
  return evaluate(ast, resource);
}

describe("FHIRPath Evaluator", () => {
  const patient = {
    resourceType: "Patient",
    gender: "male",
    birthDate: "1990-01-15",
    active: true,
    identifier: [
      { system: "http://example.org/mrn", value: "12345" },
      { system: "http://example.org/insurance", value: "INS1" },
    ],
    name: [
      { family: "Smith", given: ["John"], use: "official" },
      { family: "Smith", given: ["Johnny"], use: "nickname" },
    ],
    telecom: [
      { system: "phone", value: "555-1234", use: "home" },
      { system: "email", value: "john@example.com", use: "work" },
    ],
  };

  describe("property access", () => {
    it("accesses simple property", () => {
      expect(evalExpr("gender", patient)).toBe("male");
    });

    it("accesses nested property", () => {
      expect(evalExpr("name.family", patient)).toEqual(["Smith", "Smith"]);
    });

    it("accesses array element", () => {
      const result = evalExpr("identifier.value", patient);
      expect(result).toEqual(["12345", "INS1"]);
    });

    it("returns undefined for missing property", () => {
      expect(evalExpr("deceasedBoolean", patient)).toBeUndefined();
    });
  });

  describe("comparison operators", () => {
    it("evaluates equality", () => {
      expect(evalExpr("gender = 'male'", patient)).toBe(true);
    });

    it("evaluates inequality", () => {
      expect(evalExpr("gender = 'female'", patient)).toBe(false);
    });

    it("evaluates not equal", () => {
      expect(evalExpr("gender != 'female'", patient)).toBe(true);
    });

    it("evaluates greater than", () => {
      expect(evalExpr("identifier.count() > 1", patient)).toBe(true);
    });

    it("evaluates less than", () => {
      expect(evalExpr("identifier.count() < 1", patient)).toBe(false);
    });

    it("evaluates greater than or equal", () => {
      expect(evalExpr("identifier.count() >= 2", patient)).toBe(true);
    });
  });

  describe("logical operators", () => {
    it("evaluates 'and'", () => {
      expect(evalExpr("active and (gender = 'male')", patient)).toBe(true);
    });

    it("evaluates 'or'", () => {
      expect(evalExpr("active or (gender = 'female')", patient)).toBe(true);
    });

    it("evaluates 'not'", () => {
      expect(evalExpr("not (gender = 'female')", patient)).toBe(true);
    });

    it("evaluates 'implies'", () => {
      expect(evalExpr("active implies (gender = 'male')", patient)).toBe(true);
    });
  });

  describe("function calls", () => {
    it("evaluates empty() on present value", () => {
      expect(evalExpr("gender.empty()", patient)).toBe(false);
    });

    it("evaluates empty() on missing value", () => {
      expect(evalExpr("deceasedBoolean.empty()", patient)).toBe(true);
    });

    it("evaluates exists() on present value", () => {
      expect(evalExpr("gender.exists()", patient)).toBe(true);
    });

    it("evaluates exists() on missing value", () => {
      expect(evalExpr("deceasedBoolean.exists()", patient)).toBe(false);
    });

    it("evaluates count()", () => {
      expect(evalExpr("identifier.count()", patient)).toBe(2);
    });

    it("evaluates where() with predicate", () => {
      const result = evalExpr("identifier.where(system = 'http://example.org/mrn')", patient) as any[];
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].value).toBe("12345");
    });

    it("evaluates first()", () => {
      const result = evalExpr("identifier.first()", patient) as any;
      expect(result.value).toBe("12345");
    });

    it("evaluates last()", () => {
      const result = evalExpr("identifier.last()", patient) as any;
      expect(result.value).toBe("INS1");
    });

    it("evaluates matches()", () => {
      expect(evalExpr("birthDate.matches('\\\\d{4}-\\\\d{2}-\\\\d{2}')", patient)).toBe(true);
    });

    it("evaluates contains()", () => {
      expect(evalExpr("gender.contains('ale')", patient)).toBe(true);
    });

    it("evaluates startsWith()", () => {
      expect(evalExpr("birthDate.startsWith('1990')", patient)).toBe(true);
    });

    it("evaluates length()", () => {
      expect(evalExpr("gender.length()", patient)).toBe(4);
    });
  });

  describe("complex expressions", () => {
    it("evaluates chained functions", () => {
      expect(evalExpr("identifier.where(system = 'http://example.org/mrn').count()", patient)).toBe(1);
    });

    it("evaluates nested logical with comparison", () => {
      expect(evalExpr("(gender = 'male') and (identifier.count() > 0)", patient)).toBe(true);
    });

    it("evaluates where with multiple conditions", () => {
      const result = evalExpr(
        "telecom.where(system = 'phone' and use = 'home')",
        patient
      ) as any[];
      expect(result.length).toBe(1);
      expect(result[0].value).toBe("555-1234");
    });
  });

  describe("arithmetic", () => {
    it("evaluates addition", () => {
      expect(evalExpr("1 + 2", patient)).toBe(3);
    });

    it("evaluates subtraction", () => {
      expect(evalExpr("5 - 3", patient)).toBe(2);
    });

    it("evaluates multiplication", () => {
      expect(evalExpr("3 * 4", patient)).toBe(12);
    });

    it("evaluates division", () => {
      expect(evalExpr("10 / 2", patient)).toBe(5);
    });
  });

  describe("context ($this)", () => {
    it("resolves $this to current resource", () => {
      expect(evalExpr("$this.gender", patient)).toBe("male");
    });
  });

  describe("error handling", () => {
    it("throws on invalid expression", () => {
      expect(() => evalExpr("", patient)).toThrow();
    });

    it("handles null/undefined gracefully in property access", () => {
      expect(evalExpr("nonexistent.nested.path", patient)).toBeUndefined();
    });
  });
});
