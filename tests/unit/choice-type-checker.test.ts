import { describe, it, expect } from "bun:test";
import { checkChoiceType } from "../../src/fhir/type-checker/choice-type-checker.ts";
import type { StructureDefinitionElement } from "../../src/fhir/types.ts";

const observationValueElements: StructureDefinitionElement[] = [
  { id: "Observation.value[x]", path: "Observation.value[x]", min: 0, max: "1",
    type: [{ code: "Quantity" }, { code: "CodeableConcept" }, { code: "string" }, { code: "boolean" }, { code: "integer" }, { code: "dateTime" }] },
];

const observationValueWithFixed: StructureDefinitionElement[] = [
  { id: "Observation.value[x]", path: "Observation.value[x]", min: 0, max: "1",
    type: [{ code: "Quantity" }, { code: "CodeableConcept" }, { code: "string" }, { code: "boolean" }, { code: "integer" }, { code: "dateTime" }] },
];

describe("checkChoiceType", () => {
  describe("valid choice type usage", () => {
    it("passes when exactly one value[x] variant is present", () => {
      const resource = { valueQuantity: { value: 120, unit: "mmHg" } };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(0);
    });

    it("passes with valueString", () => {
      const resource = { valueString: "positive" };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(0);
    });

    it("passes with valueBoolean", () => {
      const resource = { valueBoolean: true };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(0);
    });

    it("passes with valueCodeableConcept", () => {
      const resource = { valueCodeableConcept: { coding: [{ system: "http://loinc.org", code: "12345" }] } };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(0);
    });

    it("passes with valueInteger", () => {
      const resource = { valueInteger: 42 };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(0);
    });

    it("passes with valueDateTime", () => {
      const resource = { valueDateTime: "2024-01-15T10:30:00Z" };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(0);
    });
  });

  describe("multiple choice types present (error)", () => {
    it("fails when two value[x] variants are present", () => {
      const resource = {
        valueQuantity: { value: 120, unit: "mmHg" },
        valueString: "high",
      };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("multiple-choice-types");
      expect(issues[0]!.severity).toBe("error");
    });

    it("reports all conflicting types in diagnostics", () => {
      const resource = {
        valueQuantity: { value: 120 },
        valueString: "high",
        valueBoolean: true,
      };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.diagnostics).toContain("valueQuantity");
      expect(issues[0]!.diagnostics).toContain("valueString");
      expect(issues[0]!.diagnostics).toContain("valueBoolean");
    });
  });

  describe("unrecognized choice type variant", () => {
    it("fails when an unknown value[x] variant is present", () => {
      const resource = { valueUnicorn: "magic" };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("unknown-choice-type");
    });
  });

  describe("no choice type present", () => {
    it("passes when no value[x] variant is present (min=0)", () => {
      const issues = checkChoiceType({}, observationValueElements, "Observation");
      expect(issues).toHaveLength(0);
    });
  });

  describe("non-choice elements are skipped", () => {
    it("does not validate non-choice elements", () => {
      const elements: StructureDefinitionElement[] = [
        { id: "Observation.status", path: "Observation.status", type: [{ code: "code" }] },
      ];
      const resource = { status: "final" };
      const issues = checkChoiceType(resource, elements, "Observation");
      expect(issues).toHaveLength(0);
    });
  });

  describe("choice type location in output", () => {
    it("includes location with the element path", () => {
      const resource = {
        valueQuantity: { value: 120 },
        valueString: "high",
      };
      const issues = checkChoiceType(resource, observationValueElements, "Observation");
      expect(issues[0]!.location).toContain("Observation.value");
    });
  });

  describe("nested choice types", () => {
    it("detects multiple choice types in nested objects", () => {
      const elements: StructureDefinitionElement[] = [
        { id: "Obs.comp.value[x]", path: "Observation.component.value[x]", type: [{ code: "Quantity" }, { code: "string" }] },
      ];
      const resource = {
        resourceType: "Observation",
        component: [{ valueString: "a", valueQuantity: { value: 1 } }],
      };
      const issues = checkChoiceType(resource, elements, "Observation");
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]!.code).toBe("multiple-choice-types");
    });
  });
});
