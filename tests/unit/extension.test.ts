import { describe, it, expect } from "bun:test";
import { validateExtensions } from "../../src/fhir/extension/extension-validator.ts";
import type { StructureDefinitionElement } from "../../src/fhir/types.ts";

describe("validateExtensions", () => {
  it("passes for valid extension with absolute URL", () => {
    const resource = {
      extension: [
        {
          url: "http://example.org/fhir/StructureDefinition/patient-nationality",
          valueCodeableConcept: { coding: [{ system: "urn:oid:2.16.840.1.113883.6.238", code: "US" }] },
        },
      ],
    };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(0);
  });

  it("fails for extension with relative URL", () => {
    const resource = {
      extension: [
        { url: "StructureDefinition/ext", valueString: "test" },
      ],
    };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("invalid-extension-url");
  });

  it("fails for extension missing url", () => {
    const resource = {
      extension: [
        { valueString: "test" },
      ],
    };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("missing-extension-url");
  });

  it("validates nested extensions", () => {
    const resource = {
      extension: [
        {
          url: "http://example.org/ext/outer",
          extension: [
            {
              url: "http://example.org/ext/inner",
              valueString: "nested value",
            },
          ],
        },
      ],
    };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(0);
  });

  it("fails for nested extension with relative URL", () => {
    const resource = {
      extension: [
        {
          url: "http://example.org/ext/outer",
          extension: [
            {
              url: "relative/path",
              valueString: "nested",
            },
          ],
        },
      ],
    };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.location).toContain("extension[0].extension[0]");
  });

  it("returns empty for resource with no extensions", () => {
    const issues = validateExtensions({ resourceType: "Patient" }, "Patient");
    expect(issues).toHaveLength(0);
  });

  it("returns empty for non-object extension values", () => {
    const resource = {
      extension: ["not-an-object"],
    };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(0);
  });

  it("validates extension with value[x] variants", () => {
    const resource = {
      extension: [
        { url: "http://example.org/ext", valueBoolean: true },
        { url: "http://example.org/ext2", valueInteger: 42 },
        { url: "http://example.org/ext3", valueString: "test" },
      ],
    };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(0);
  });

  it("catches extension depth limit exceeded", () => {
    let deep: Record<string, unknown> = { url: "http://example.org/leaf", valueString: "deep" };
    for (let i = 0; i < 20; i++) {
      deep = { url: `http://example.org/level-${i}`, extension: [deep] };
    }
    const resource = { extension: [deep] };
    const issues = validateExtensions(resource, "Patient");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("extension-depth-exceeded");
  });
});
