import { describe, it, expect } from "bun:test";
import { validateBundle } from "../../src/fhir/bundle-validator.ts";
import type { StructureDefinition, ValidationIssue } from "../../src/fhir/types.ts";

describe("validateBundle", () => {
  const bundleSD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "Bundle",
    url: "http://hl7.org/fhir/StructureDefinition/Bundle",
    type: "Bundle",
    differential: {
      element: [
        { id: "Bundle.type", path: "Bundle.type", type: [{ code: "code" }], min: 1, max: "1" },
        { id: "Bundle.entry", path: "Bundle.entry", min: 0, max: "*" },
        { id: "Bundle.entry.request", path: "Bundle.entry.request", min: 0, max: "1" },
        { id: "Bundle.entry.request.method", path: "Bundle.entry.request.method", type: [{ code: "code" }], min: 1, max: "1" },
        { id: "Bundle.entry.request.url", path: "Bundle.entry.request.url", type: [{ code: "uri" }], min: 1, max: "1" },
        { id: "Bundle.entry.response", path: "Bundle.entry.response", min: 0, max: "1" },
      ],
    },
  };

  it("validates a valid batch bundle", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "batch",
      entry: [
        {
          request: { method: "POST", url: "Patient" },
          resource: { resourceType: "Patient" },
        },
      ],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues).toHaveLength(0);
  });

  it("validates a valid transaction bundle", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          request: { method: "POST", url: "Patient" },
          resource: { resourceType: "Patient" },
        },
      ],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues).toHaveLength(0);
  });

  it("fails when Bundle.type is missing", () => {
    const bundle = { resourceType: "Bundle", entry: [] };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues.some(i => i.code === "cardinality" || i.code === "invalid-value")).toBe(true);
  });

  it("fails when entry.request.method is missing", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "batch",
      entry: [{ request: { url: "Patient" } }],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues.some(i => i.location?.includes("request.method"))).toBe(true);
  });

  it("fails when entry.request.url is missing", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "batch",
      entry: [{ request: { method: "POST" } }],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues.some(i => i.location?.includes("request.url"))).toBe(true);
  });

  it("validates multiple entries independently", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "batch",
      entry: [
        { request: { method: "POST", url: "Patient" }, resource: { resourceType: "Patient" } },
        { request: { method: "PUT", url: "Patient/123" }, resource: { resourceType: "Patient" } },
      ],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues).toHaveLength(0);
  });

  it("reports errors for each invalid entry", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "batch",
      entry: [
        { request: { url: "Patient" } },
        { request: { method: "POST" } },
      ],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty for bundle with no entries", () => {
    const bundle = { resourceType: "Bundle", type: "batch" };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues).toHaveLength(0);
  });

  it("returns empty for non-Bundle resourceType", () => {
    const issues = validateBundle({ resourceType: "Patient" }, bundleSD);
    expect(issues).toHaveLength(0);
  });

  it("validates entry with fullUrl", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "batch",
      entry: [
        {
          fullUrl: "urn:uuid:12345",
          request: { method: "POST", url: "Patient" },
          resource: { resourceType: "Patient" },
        },
      ],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues).toHaveLength(0);
  });

  it("validates entry with response", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "batch-response",
      entry: [
        {
          response: { status: "201 Created" },
          resource: { resourceType: "Patient" },
        },
      ],
    };
    const issues = validateBundle(bundle, bundleSD);
    expect(issues).toHaveLength(0);
  });

  describe("valid Bundle types", () => {
    it("accepts document type", () => {
      const bundle = {
        resourceType: "Bundle",
        type: "document",
        entry: [{ resource: { resourceType: "Patient" } }],
      };
      const issues = validateBundle(bundle, bundleSD);
      expect(issues).toHaveLength(0);
    });

    it("accepts searchset type", () => {
      const bundle = {
        resourceType: "Bundle",
        type: "searchset",
        entry: [{ resource: { resourceType: "Patient" } }],
      };
      const issues = validateBundle(bundle, bundleSD);
      expect(issues).toHaveLength(0);
    });

    it("accepts history type", () => {
      const bundle = {
        resourceType: "Bundle",
        type: "history",
        entry: [{ resource: { resourceType: "Patient" } }],
      };
      const issues = validateBundle(bundle, bundleSD);
      expect(issues).toHaveLength(0);
    });
  });
});
