import { describe, it, expect } from "bun:test";
import { checkFixedValue, checkComplexType } from "../../src/fhir/type-checker/complex-type-checker.ts";
import type { StructureDefinitionElement } from "../../src/fhir/types.ts";

describe("checkFixedValue", () => {
  const fixedCodeEl: StructureDefinitionElement = {
    id: "Observation.status",
    path: "Observation.status",
    type: [{ code: "code" }],
    fixedCode: "final",
  };

  const fixedStringEl: StructureDefinitionElement = {
    id: "Device.deviceName.name",
    path: "Device.deviceName.name",
    type: [{ code: "string" }],
    fixedString: "My Device",
  };

  const fixedUriEl: StructureDefinitionElement = {
    id: "ValueSet.url",
    path: "ValueSet.url",
    type: [{ code: "uri" }],
    fixedUri: "http://example.org/fhir/ValueSet/my-vs",
  };

  const fixedBooleanEl: StructureDefinitionElement = {
    id: "Consent.provision.provision",
    path: "Consent.provision.provision",
    type: [{ code: "boolean" }],
    fixedBoolean: false,
  };

  it("passes when value matches fixedCode", () => {
    const issues = checkFixedValue("final", fixedCodeEl);
    expect(issues).toHaveLength(0);
  });

  it("fails when value does not match fixedCode", () => {
    const issues = checkFixedValue("preliminary", fixedCodeEl);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("fixed-value");
    expect(issues[0]!.diagnostics).toContain("final");
  });

  it("passes when value matches fixedString", () => {
    const issues = checkFixedValue("My Device", fixedStringEl);
    expect(issues).toHaveLength(0);
  });

  it("fails when value does not match fixedString", () => {
    const issues = checkFixedValue("Other Device", fixedStringEl);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("fixed-value");
  });

  it("passes when value matches fixedUri", () => {
    const issues = checkFixedValue("http://example.org/fhir/ValueSet/my-vs", fixedUriEl);
    expect(issues).toHaveLength(0);
  });

  it("fails when value does not match fixedUri", () => {
    const issues = checkFixedValue("http://wrong.org", fixedUriEl);
    expect(issues).toHaveLength(1);
  });

  it("passes when value matches fixedBoolean", () => {
    const issues = checkFixedValue(false, fixedBooleanEl);
    expect(issues).toHaveLength(0);
  });

  it("fails when value does not match fixedBoolean", () => {
    const issues = checkFixedValue(true, fixedBooleanEl);
    expect(issues).toHaveLength(1);
  });

  it("returns empty when element has no fixed value", () => {
    const el: StructureDefinitionElement = {
      id: "test",
      path: "Resource.test",
      type: [{ code: "string" }],
    };
    const issues = checkFixedValue("anything", el);
    expect(issues).toHaveLength(0);
  });
});

describe("checkComplexType", () => {
  it("validates HumanName structure", () => {
    const element: StructureDefinitionElement = {
      id: "Patient.name",
      path: "Patient.name",
      type: [{ code: "HumanName" }],
      min: 1,
    };
    const issues = checkComplexType(
      { family: "Smith", given: ["John"], use: "official" },
      element,
      "Patient.name[0]"
    );
    expect(issues).toHaveLength(0);
  });

  it("validates nested BackboneElement structure", () => {
    const elements: StructureDefinitionElement[] = [
      { id: "Observation.referenceRange", path: "Observation.referenceRange", type: [{ code: "BackboneElement" }], min: 1 },
      { id: "Observation.referenceRange.low", path: "Observation.referenceRange.low", type: [{ code: "Quantity" }], min: 1 },
    ];
    const resource = {
      referenceRange: [{ low: { value: 10, unit: "mg" } }],
    };
    const issues = checkComplexType(resource, elements[0]!, "Observation.referenceRange[0]");
    expect(issues).toHaveLength(0);
  });

  it("detects missing required nested field in BackboneElement", () => {
    const elements: StructureDefinitionElement[] = [
      { id: "Observation.referenceRange", path: "Observation.referenceRange", type: [{ code: "BackboneElement" }] },
      { id: "Observation.referenceRange.low", path: "Observation.referenceRange.low", type: [{ code: "Quantity" }], min: 1 },
    ];
    const resource = {
      referenceRange: [{ high: { value: 100, unit: "mg" } }],
    };
    const issues = checkComplexType(resource, elements[0]!, "Observation.referenceRange[0]", [elements[1]!]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("cardinality");
  });

  it("validates an array of complex elements", () => {
    const element: StructureDefinitionElement = {
      id: "Patient.name",
      path: "Patient.name",
      type: [{ code: "HumanName" }],
      min: 1,
    };
    const resource = [
      { family: "Smith", given: ["John"] },
      { family: "Jones", given: ["Jane"] },
    ];
    const issues = checkComplexType(resource, element, "Patient.name");
    expect(issues).toHaveLength(0);
  });

  it("skips non-object values gracefully", () => {
    const element: StructureDefinitionElement = {
      id: "Test.field",
      path: "Test.field",
      type: [{ code: "BackboneElement" }],
    };
    const issues = checkComplexType("not an object", element, "Test.field");
    expect(issues).toHaveLength(0);
  });
});
