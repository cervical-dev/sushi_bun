import { describe, it, expect } from "bun:test";
import fc from "fast-check";
import {
  expressionToJsonPath,
  deriveSearchPath,
  resolveSearchParamMapping,
  type SearchParameterResource,
} from "../../src/fhir/search-param-resolver.ts";
import type { SearchParamConfig } from "../../src/fhir/types.ts";

describe("expressionToJsonPath", () => {
  it("strips type prefix from simple element", () => {
    expect(expressionToJsonPath("Patient.name")).toBe("$.name");
  });

  it("strips type prefix from nested element", () => {
    expect(expressionToJsonPath("Patient.name.family")).toBe("$.name.family");
  });

  it("strips type prefix from deeply nested element", () => {
    expect(expressionToJsonPath("Observation.code.coding.code")).toBe("$.code.coding.code");
  });

  it("strips type prefix from single-segment path", () => {
    expect(expressionToJsonPath("Patient.gender")).toBe("$.gender");
  });

  it("handles reference expression", () => {
    expect(expressionToJsonPath("Observation.subject")).toBe("$.subject");
  });

  it("returns fallback when expression is empty", () => {
    expect(expressionToJsonPath("", "name")).toBe("$.name");
  });

  it("returns fallback when expression has no dot", () => {
    expect(expressionToJsonPath("nodot", "gender")).toBe("$.gender");
  });

  it("property: output always starts with $", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-zA-Z]+\.[a-z]+(\.[a-z]+)*$/),
        (expr) => {
          const result = expressionToJsonPath(expr);
          return result.startsWith("$.");
        }
      )
    );
  });

  it("property: output never contains the original type prefix", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-zA-Z]+\.[a-z]+(\.[a-z]+)*$/),
        (expr) => {
          const typeName = expr.split(".")[0]!;
          const result = expressionToJsonPath(expr);
          return !result.includes(typeName);
        }
      )
    );
  });

  it("property: nested paths preserve segment order", () => {
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constant("Patient"),
          root: fc.constant("name"),
          leaf: fc.stringMatching(/^[a-z]+$/),
        }),
        ({ type, root, leaf }) => {
          const expr = `${type}.${root}.${leaf}`;
          const result = expressionToJsonPath(expr);
          return result === `$.${root}.${leaf}`;
        }
      )
    );
  });
});

describe("deriveSearchPath", () => {
  it("returns $.code.coding for CodeableConcept token (expression ends with 'code')", () => {
    expect(deriveSearchPath("Observation.code", "token")).toBe("$.code.coding");
  });

  it("returns $.code.coding for reasonCode token", () => {
    expect(deriveSearchPath("Observation.reasonCode", "token")).toBe("$.reasonCode.coding");
  });

  it("returns $.code.coding for method token", () => {
    expect(deriveSearchPath("Procedure.method", "token")).toBe("$.method.coding");
  });

  it("returns $.identifier for Identifier token", () => {
    expect(deriveSearchPath("Patient.identifier", "token")).toBe("$.identifier");
  });

  it("returns $.gender for simple token", () => {
    expect(deriveSearchPath("Patient.gender", "token")).toBe("$.gender");
  });

  it("returns $.status for simple token", () => {
    expect(deriveSearchPath("Observation.status", "token")).toBe("$.status");
  });

  it("returns $.name for string type", () => {
    expect(deriveSearchPath("Patient.name", "string")).toBe("$.name");
  });

  it("returns $.name.family for nested string", () => {
    expect(deriveSearchPath("Patient.name.family", "string")).toBe("$.name.family");
  });

  it("returns $.subject.reference for reference type (expression already ends with .reference)", () => {
    expect(deriveSearchPath("Observation.subject.reference", "reference")).toBe("$.subject.reference");
  });

  it("returns $.patient.reference for reference with single segment", () => {
    expect(deriveSearchPath("Encounter.patient", "reference")).toBe("$.patient.reference");
  });

  it("returns $.birthDate for date type", () => {
    expect(deriveSearchPath("Patient.birthDate", "date")).toBe("$.birthDate");
  });

  it("returns $.unknown for empty expression", () => {
    expect(deriveSearchPath("", "string")).toBe("$.unknown");
  });

  it("returns $.param for expression without dot", () => {
    expect(deriveSearchPath("nodot", "string")).toBe("$.nodot");
  });

  it("property: output always starts with $", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-zA-Z]+\.[a-z]+(\.[a-z]+)*$/),
        fc.constantFrom("string", "token", "reference", "date"),
        (expr, type) => {
          const result = deriveSearchPath(expr, type);
          return result.startsWith("$.");
        }
      )
    );
  });

  it("property: token with known CodeableConcept field always contains .coding", () => {
    const ccFields = ["code", "reasonCode", "method", "category", "partOf"];
    fc.assert(
      fc.property(
        fc.constantFrom(...ccFields),
        fc.constant("Patient"),
        (field, typeName) => {
          const expr = `${typeName}.${field}`;
          const result = deriveSearchPath(expr, "token");
          return result.includes(".coding");
        }
      )
    );
  });

  it("property: token with known Identifier field always equals $.identifier", () => {
    fc.assert(
      fc.property(
        fc.constant("identifier"),
        fc.constant("Patient"),
        (field, typeName) => {
          const expr = `${typeName}.${field}`;
          const result = deriveSearchPath(expr, "token");
          return result === "$.identifier";
        }
      )
    );
  });
});

describe("resolveSearchParamMapping", () => {
  const searchParams: Map<string, SearchParamConfig> = new Map([
    ["name", { name: "name", type: "string" }],
    ["gender", { name: "gender", type: "token" }],
    ["code", { name: "code", type: "token" }],
  ]);

  const searchParameters: SearchParameterResource[] = [
    {
      url: "http://example.org/fhir/SearchParameter/Patient-name",
      name: "name",
      code: "name",
      type: "string",
      expression: "Patient.name",
    },
    {
      url: "http://example.org/fhir/SearchParameter/Patient-gender",
      name: "gender",
      code: "gender",
      type: "token",
      expression: "Patient.gender",
    },
    {
      url: "http://example.org/fhir/SearchParameter/Observation-code",
      name: "code",
      code: "code",
      type: "token",
      expression: "Observation.code",
    },
  ];

  it("builds mapping from SearchParameter expressions", () => {
    const mapping = resolveSearchParamMapping(searchParams, searchParameters);
    expect(mapping.get("name")?.jsonPath).toBe("$.name");
    expect(mapping.get("gender")?.jsonPath).toBe("$.gender");
    expect(mapping.get("code")?.jsonPath).toBe("$.code");
  });

  it("derives searchPath from type and expression", () => {
    const mapping = resolveSearchParamMapping(searchParams, searchParameters);
    expect(mapping.get("name")?.searchPath).toBe("$.name");       // string → same as jsonPath
    expect(mapping.get("gender")?.searchPath).toBe("$.gender");   // simple token → same
    expect(mapping.get("code")?.searchPath).toBe("$.code.coding"); // CodeableConcept → coding array
  });

  it("falls back to $.paramName when no SearchParameter matches", () => {
    const unmatchedParams: Map<string, SearchParamConfig> = new Map([
      ["unknown", { name: "unknown", type: "string" }],
    ]);
    const mapping = resolveSearchParamMapping(unmatchedParams, searchParameters);
    expect(mapping.get("unknown")?.jsonPath).toBe("$.unknown");
  });

  it("falls back to $.paramName when expression is missing", () => {
    const paramsNoExpr: Map<string, SearchParamConfig> = new Map([
      ["name", { name: "name", type: "string" }],
    ]);
    const spsNoExpr: SearchParameterResource[] = [
      { url: "http://example.org/sp/name", name: "name", code: "name", type: "string" },
    ];
    const mapping = resolveSearchParamMapping(paramsNoExpr, spsNoExpr);
    expect(mapping.get("name")?.jsonPath).toBe("$.name");
  });

  it("handles nested expressions", () => {
    const nestedParams: Map<string, SearchParamConfig> = new Map([
      ["family", { name: "family", type: "string" }],
    ]);
    const nestedSPs: SearchParameterResource[] = [
      { url: "http://example.org/sp/family", name: "family", code: "family", type: "string", expression: "Patient.name.family" },
    ];
    const mapping = resolveSearchParamMapping(nestedParams, nestedSPs);
    expect(mapping.get("family")?.jsonPath).toBe("$.name.family");
  });

  it("last-wins when two SearchParameters have the same code", () => {
    const params: Map<string, SearchParamConfig> = new Map([
      ["code", { name: "code", type: "token" }],
    ]);
    const sps: SearchParameterResource[] = [
      { url: "http://example.org/sp/code-v1", name: "code-v1", code: "code", type: "token", expression: "Observation.code" },
      { url: "http://example.org/sp/code-v2", name: "code-v2", code: "code", type: "token", expression: "Observation.category" },
    ];
    const mapping = resolveSearchParamMapping(params, sps);
    expect(mapping.get("code")?.searchPath).toBe("$.category.coding");
  });

  it("no collision when SearchParameters have different codes", () => {
    const params: Map<string, SearchParamConfig> = new Map([
      ["code", { name: "code", type: "token" }],
      ["status", { name: "status", type: "token" }],
    ]);
    const sps: SearchParameterResource[] = [
      { url: "http://example.org/sp/code", name: "code", code: "code", type: "token", expression: "Observation.code" },
      { url: "http://example.org/sp/status", name: "status", code: "status", type: "token", expression: "Observation.status" },
    ];
    const mapping = resolveSearchParamMapping(params, sps);
    expect(mapping.get("code")?.searchPath).toBe("$.code.coding");
    expect(mapping.get("status")?.searchPath).toBe("$.status");
  });

  it("property: mapping always has an entry for every search param", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z]+$/),
            type: fc.constantFrom("string", "token", "reference", "date"),
          })
        ),
        (params) => {
          const paramMap = new Map<string, SearchParamConfig>(
            params.map((p) => [p.name, p])
          );
          const mapping = resolveSearchParamMapping(paramMap, []);
          for (const p of params) {
            expect(mapping.has(p.name)).toBe(true);
          }
        }
      )
    );
  });

  it("property: jsonPath always starts with $", () => {
    fc.assert(
      fc.property(
          fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z]+$/),
            type: fc.constantFrom("string", "token"),
            expression: fc.stringMatching(/^[A-Z][a-zA-Z]+\.[a-z]+$/),
          })
        ),
        (sps) => {
          const paramMap = new Map<string, SearchParamConfig>(
            sps.map((s) => [s.name, { name: s.name, type: s.type }])
          );
          const spResources: SearchParameterResource[] = sps.map((s) => ({
            url: `http://example.org/sp/${s.name}`,
            name: s.name,
            code: s.name,
            type: s.type,
            expression: s.expression,
          }));
          const mapping = resolveSearchParamMapping(paramMap, spResources);
          for (const sp of sps) {
            const entry = mapping.get(sp.name)!;
            expect(entry.jsonPath.startsWith("$")).toBe(true);
            expect(entry.searchPath.startsWith("$")).toBe(true);
          }
        }
      )
    );
  });
});
