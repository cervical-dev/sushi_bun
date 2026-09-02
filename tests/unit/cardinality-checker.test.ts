import { describe, it, expect } from "bun:test";
import { checkCardinality } from "../../src/fhir/type-checker/cardinality-checker.ts";
import type { StructureDefinitionElement } from "../../src/fhir/types.ts";

function el(overrides: Partial<StructureDefinitionElement>): StructureDefinitionElement {
  return { id: "test", path: "Resource.test", ...overrides };
}

describe("checkCardinality", () => {
  describe("min constraint (required)", () => {
    it("passes when value is present and min=1", () => {
      const issues = checkCardinality({ test: "hello" }, el({ min: 1, max: "1" }), "Resource");
      expect(issues).toHaveLength(0);
    });

    it("fails when value is undefined and min=1", () => {
      const issues = checkCardinality({}, el({ min: 1, max: "1" }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("cardinality");
      expect(issues[0]!.diagnostics).toContain("at least 1");
    });

    it("fails when value is empty array and min=1", () => {
      const issues = checkCardinality({ test: [] }, el({ min: 1, max: "*" }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("cardinality");
    });

    it("passes when value is array with 2 items and min=1", () => {
      const issues = checkCardinality({ test: ["a", "b"] }, el({ min: 1, max: "*" }), "Resource");
      expect(issues).toHaveLength(0);
    });

    it("passes when min=0 and value is missing", () => {
      const issues = checkCardinality({}, el({ min: 0, max: "1" }), "Resource");
      expect(issues).toHaveLength(0);
    });

    it("fails when min=2 and only 1 item", () => {
      const issues = checkCardinality({ test: ["a"] }, el({ min: 2, max: "*" }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.diagnostics).toContain("at least 2");
    });
  });

  describe("max constraint", () => {
    it("fails when max=1 and array has 2 items", () => {
      const issues = checkCardinality({ test: ["a", "b"] }, el({ min: 0, max: "1" }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.diagnostics).toContain("at most 1");
    });

    it("passes when max=1 and single value", () => {
      const issues = checkCardinality({ test: "a" }, el({ min: 0, max: "1" }), "Resource");
      expect(issues).toHaveLength(0);
    });

    it("passes when max=* (unbounded)", () => {
      const issues = checkCardinality({ test: Array(100).fill("x") }, el({ min: 0, max: "*" }), "Resource");
      expect(issues).toHaveLength(0);
    });

    it("fails when max=2 and 3 items", () => {
      const issues = checkCardinality({ test: ["a", "b", "c"] }, el({ min: 0, max: "2" }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.diagnostics).toContain("at most 2");
    });

    it("passes when max not specified (unbounded)", () => {
      const issues = checkCardinality({ test: ["a", "b", "c"] }, el({ min: 0 }), "Resource");
      expect(issues).toHaveLength(0);
    });
  });

  describe("combined min and max", () => {
    it("reports both min and max violations independently", () => {
      const issues = checkCardinality({ test: ["a", "b", "c"] }, el({ min: 4, max: "2" }), "Resource");
      expect(issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("null value handling", () => {
    it("treats null as absent (count=0)", () => {
      const issues = checkCardinality({ test: null }, el({ min: 1, max: "1" }), "Resource");
      expect(issues).toHaveLength(1);
    });

    it("treats explicit undefined as absent", () => {
      const issues = checkCardinality({ test: undefined }, el({ min: 1, max: "1" }), "Resource");
      expect(issues).toHaveLength(1);
    });
  });

  describe("nested path resolution", () => {
    it("validates nested element cardinality", () => {
      const resource = { name: [{ given: ["John"] }] };
      const issues = checkCardinality(resource, el({ path: "Resource.name.family", min: 1 }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.location).toContain("name[0].family");
    });

    it("validates each array item independently", () => {
      const resource = {
        name: [
          { family: "Smith" },
          { given: ["Jane"] },
        ],
      };
      const issues = checkCardinality(resource, el({ path: "Resource.name.family", min: 1 }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.location).toContain("name[1].family");
    });

    it("passes when all nested items satisfy min", () => {
      const resource = {
        name: [
          { family: "Smith", given: ["John"] },
          { family: "Jones", given: ["Jane"] },
        ],
      };
      const issues = checkCardinality(resource, el({ path: "Resource.name.family", min: 1 }), "Resource");
      expect(issues).toHaveLength(0);
    });

    it("handles deeply nested paths", () => {
      const resource = {
        identifier: [
          { type: { coding: [{ code: "MR" }] } },
          { type: { coding: [{ }] } },
        ],
      };
      const issues = checkCardinality(resource, el({ path: "Resource.identifier.type.coding.code", min: 1 }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.location).toContain("identifier[1].type.coding[0].code");
    });
  });

  describe("missing parent in path", () => {
    it("produces no issues when parent is missing (element is absent)", () => {
      const issues = checkCardinality({}, el({ path: "Resource.name.family", min: 1 }), "Resource");
      expect(issues).toHaveLength(0);
    });
  });

  describe("max cardinality with nested arrays", () => {
    it("enforces max on nested array items", () => {
      const resource = {
        name: [
          { given: ["John", "Johnny", "J"] },
        ],
      };
      const issues = checkCardinality(resource, el({ path: "Resource.name.given", min: 0, max: "2" }), "Resource");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.diagnostics).toContain("at most 2");
    });
  });
});
