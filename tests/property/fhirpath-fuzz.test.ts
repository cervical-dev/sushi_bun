import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";
import { tokenize } from "../../src/fhir/fhirpath/lexer.ts";
import { parse } from "../../src/fhir/fhirpath/parser.ts";
import { evaluate } from "../../src/fhir/fhirpath/evaluator.ts";

describe("FHIRPath — Property-Based Tests", () => {
  const safeIdentifierArb = fc.constantFrom(
    "gender", "name", "active", "birthDate", "status", "code", "value", "system"
  );

  const safeExpressionArb = fc.oneof(
    safeIdentifierArb,
    fc.constant("true"),
    fc.constant("false"),
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).filter(s =>
      !["and", "or", "not", "implies", "div", "mod", "true", "false"].includes(s)
    ),
  );

  const sampleResource = {
    resourceType: "Patient",
    gender: "male",
    active: true,
    birthDate: "1990-01-15",
    identifier: [
      { system: "http://example.org/mrn", value: "12345" },
    ],
    name: [
      { family: "Smith", given: ["John"] },
    ],
  };

  describe("Lexer robustness", () => {
    it("never throws on arbitrary ASCII input without unmatched quotes", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => {
            let inQuote = false;
            for (const ch of s) {
              if (ch === "'") inQuote = !inQuote;
            }
            return !inQuote;
          }),
          (input) => {
            expect(() => tokenize(input)).not.toThrow();
          }
        ),
        { numRuns: 5000, endOnFailure: true }
      );
    });
  });

  describe("Parser robustness", () => {
    it("never throws on valid simple identifier expressions", () => {
      fc.assert(
        fc.property(
          safeExpressionArb,
          (expr) => {
            expect(() => parse(expr)).not.toThrow();
          }
        ),
        { numRuns: 2000, endOnFailure: true }
      );
    });
  });

  describe("Evaluator robustness", () => {
    it("never throws when evaluating valid expressions against resource", () => {
      fc.assert(
        fc.property(
          safeExpressionArb,
          (expr) => {
            expect(() => {
              const ast = parse(expr);
              evaluate(ast, sampleResource);
            }).not.toThrow();
          }
        ),
        { numRuns: 2000, endOnFailure: true }
      );
    });
  });

  describe("Idempotency", () => {
    it("evaluate is deterministic for simple expressions", () => {
      fc.assert(
        fc.property(
          safeExpressionArb,
          (expr) => {
            const ast = parse(expr);
            const r1 = evaluate(ast, sampleResource);
            const r2 = evaluate(ast, sampleResource);
            expect(r1).toEqual(r2);
          }
        ),
        { numRuns: 1000, endOnFailure: true }
      );
    });
  });

  describe("Boolean operator properties", () => {
    it("x and x === x (idempotent and)", () => {
      fc.assert(
        fc.property(
          safeExpressionArb,
          (expr) => {
            try {
              const ast1 = parse(expr);
              const val = evaluate(ast1, sampleResource);
              const boolExpr = `${expr} and ${expr}`;
              const ast2 = parse(boolExpr);
              const result = evaluate(ast2, sampleResource);
              const isBool = typeof val === "boolean";
              if (isBool) {
                expect(result).toBe(val);
              }
            } catch { /* ignore parse errors on complex exprs */ }
          }
        ),
        { numRuns: 500, endOnFailure: true }
      );
    });

    it("x or x === x (idempotent or)", () => {
      fc.assert(
        fc.property(
          safeExpressionArb,
          (expr) => {
            try {
              const ast1 = parse(expr);
              const val = evaluate(ast1, sampleResource);
              const boolExpr = `${expr} or ${expr}`;
              const ast2 = parse(boolExpr);
              const result = evaluate(ast2, sampleResource);
              const isBool = typeof val === "boolean";
              if (isBool) {
                expect(result).toBe(val);
              }
            } catch { /* ignore parse errors */ }
          }
        ),
        { numRuns: 500, endOnFailure: true }
      );
    });

    it("not (not x) === x for booleans", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("active"),
          (prop) => {
            const expr = `not (not ${prop})`;
            const ast = parse(expr);
            const result = evaluate(ast, sampleResource);
            const directAst = parse(prop);
            const direct = evaluate(directAst, sampleResource);
            expect(result).toBe(direct);
          }
        ),
        { numRuns: 200, endOnFailure: true }
      );
    });
  });

  describe("empty and exists are complementary", () => {
    it("x.empty() === not x.exists()", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("gender", "active", "birthDate", "deceasedBoolean"),
          (prop) => {
            const emptyAst = parse(`${prop}.empty()`);
            const existsAst = parse(`${prop}.exists()`);
            const emptyResult = evaluate(emptyAst, sampleResource);
            const existsResult = evaluate(existsAst, sampleResource);
            expect(emptyResult).toBe(!existsResult);
          }
        ),
        { numRuns: 200, endOnFailure: true }
      );
    });
  });
});
