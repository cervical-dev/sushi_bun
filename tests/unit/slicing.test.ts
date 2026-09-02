import { describe, it, expect } from "bun:test";
import { validateSlicing } from "../../src/fhir/slicing/slice-validator.ts";
import type { StructureDefinitionElement, ElementSlicing } from "../../src/fhir/types.ts";

describe("validateSlicing", () => {
  const slicing: ElementSlicing = {
    discriminator: [{ type: "value", path: "type.coding.code" }],
    rules: "closed",
  };

  const slicedElements: StructureDefinitionElement[] = [
    {
      id: "Patient.identifier",
      path: "Patient.identifier",
      slicing,
      min: 1,
      max: "*",
    },
    {
      id: "Patient.identifier:mrn",
      path: "Patient.identifier",
      sliceName: "mrn",
      min: 1,
      max: "1",
    },
    {
      id: "Patient.identifier:insurance",
      path: "Patient.identifier",
      sliceName: "insurance",
      min: 0,
      max: "1",
    },
  ];

  it("passes when all required slices are present", () => {
    const resource = {
      identifier: [
        { type: { coding: [{ code: "mrn" }] }, system: "http://example.org/mrn", value: "123" },
        { type: { coding: [{ code: "insurance" }] }, system: "http://example.org/insurance", value: "INS1" },
      ],
    };
    const issues = validateSlicing(resource, "Patient.identifier", slicedElements);
    expect(issues).toHaveLength(0);
  });

  it("fails when required slice is missing", () => {
    const resource = {
      identifier: [
        { type: { coding: [{ code: "insurance" }] }, system: "http://example.org/insurance", value: "INS1" },
      ],
    };
    const issues = validateSlicing(resource, "Patient.identifier", slicedElements);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.code === "missing-slice")).toBe(true);
  });

  it("fails when closed slicing has unrecognized slice", () => {
    const resource = {
      identifier: [
        { type: { coding: [{ code: "mrn" }] }, system: "http://example.org/mrn", value: "123" },
        { type: { coding: [{ code: "unknown" }] }, system: "http://example.org/unknown", value: "UNK" },
      ],
    };
    const issues = validateSlicing(resource, "Patient.identifier", slicedElements);
    expect(issues.some(i => i.code === "unrecognized-slice")).toBe(true);
  });

  it("passes when open slicing has unrecognized slice", () => {
    const openSlicingElements: StructureDefinitionElement[] = [
      {
        id: "Patient.identifier",
        path: "Patient.identifier",
        slicing: { discriminator: [{ type: "value", path: "type.coding.code" }], rules: "open" },
        min: 1,
        max: "*",
      },
      {
        id: "Patient.identifier:mrn",
        path: "Patient.identifier",
        sliceName: "mrn",
        min: 1,
        max: "1",
      },
    ];

    const resource = {
      identifier: [
        { type: { coding: [{ code: "mrn" }] }, system: "http://example.org/mrn", value: "123" },
        { type: { coding: [{ code: "unknown" }] }, system: "http://example.org/unknown", value: "UNK" },
      ],
    };
    const issues = validateSlicing(resource, "Patient.identifier", openSlicingElements);
    expect(issues.some(i => i.code === "unrecognized-slice")).toBe(false);
  });

  it("returns empty when element is not sliced", () => {
    const elements: StructureDefinitionElement[] = [
      { id: "Patient.name", path: "Patient.name", min: 0, max: "*" },
    ];
    const issues = validateSlicing({ name: [] }, "Patient.name", elements);
    expect(issues).toHaveLength(0);
  });

  it("returns empty when element not present in resource", () => {
    const issues = validateSlicing({}, "Patient.identifier", slicedElements);
    expect(issues).toHaveLength(0);
  });
});
