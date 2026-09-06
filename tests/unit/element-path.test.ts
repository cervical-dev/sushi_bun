import { describe, it, expect } from "bun:test";
import {
  resolvePathNodes,
  formatLocation,
  parseMax,
  countValue,
} from "../../src/fhir/element-path.ts";

describe("resolvePathNodes", () => {
  it("resolves a nested object path to intermediate objects", () => {
    const resource = {
      name: [{ given: ["John"], family: "Doe" }],
    };
    const result = resolvePathNodes(resource, ["name"]);
    expect(result.length).toBe(1);
    expect(result[0]!.pathWithIndices).toEqual(["name[0]"]);
    expect(result[0]!.node).toEqual({ given: ["John"], family: "Doe" });
  });

  it("resolves an array of objects and expands with [i] indices", () => {
    const resource = {
      name: [
        { given: ["Alice"], family: "Smith" },
        { given: ["Bob"], family: "Jones" },
      ],
    };
    const result = resolvePathNodes(resource, ["name"]);
    expect(result.length).toBe(2);
    expect(result[0]!.pathWithIndices).toEqual(["name[0]"]);
    expect(result[1]!.pathWithIndices).toEqual(["name[1]"]);
  });

  it("returns empty list for missing key", () => {
    const resource = { name: [] };
    const result = resolvePathNodes(resource, ["missing"]);
    expect(result).toEqual([]);
  });

  it("returns empty list for plain value leaf (not an object)", () => {
    const resource = { name: "John" };
    const result = resolvePathNodes(resource, ["name"]);
    expect(result).toEqual([]);
  });

  it("returns empty list when path ends at a primitive array", () => {
    const resource = {
      name: [{ given: ["John"] }],
    };
    const result = resolvePathNodes(resource, ["name", "given"]);
    expect(result).toEqual([]);
  });

  it("skips null items in arrays", () => {
    const resource = {
      name: [null, { family: "Alice" }],
    };
    const result = resolvePathNodes(resource, ["name"]);
    expect(result.length).toBe(1);
    expect(result[0]!.pathWithIndices).toEqual(["name[1]"]);
  });

  it("handles deeply nested object paths", () => {
    const resource = {
      a: { b: { c: { d: "deep" } } },
    };
    const result = resolvePathNodes(resource, ["a", "b", "c"]);
    expect(result.length).toBe(1);
    expect(result[0]!.node).toEqual({ d: "deep" });
    expect(result[0]!.pathWithIndices).toEqual(["a", "b", "c"]);
  });

  it("returns root object for empty path", () => {
    const resource = { name: "John" };
    const result = resolvePathNodes(resource, []);
    expect(result.length).toBe(1);
    expect(result[0]!.node).toBe(resource);
    expect(result[0]!.pathWithIndices).toEqual([]);
  });
});

describe("formatLocation", () => {
  it("formats Patient.name[0].family", () => {
    const result = formatLocation("Patient", ["name[0]"], "family");
    expect(result).toBe("Patient.name[0].family");
  });

  it("formats with no path segments", () => {
    const result = formatLocation("Patient", [], "name");
    expect(result).toBe("Patient.name");
  });

  it("formats with multiple path segments", () => {
    const result = formatLocation("Patient", ["name[0]", "given[1]"], "family");
    expect(result).toBe("Patient.name[0].given[1].family");
  });

  it("formats with empty leaf name", () => {
    const result = formatLocation("Patient", ["name[0]"], "");
    expect(result).toBe("Patient.name[0]");
  });
});

describe("parseMax", () => {
  it("returns undefined for *", () => {
    expect(parseMax("*")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseMax(undefined)).toBeUndefined();
  });

  it("parses a valid number string", () => {
    expect(parseMax("5")).toBe(5);
  });

  it("returns undefined for bad input", () => {
    expect(parseMax("abc")).toBeUndefined();
  });

  it("parses zero", () => {
    expect(parseMax("0")).toBe(0);
  });

  it("parses large numbers", () => {
    expect(parseMax("100")).toBe(100);
  });
});

describe("countValue", () => {
  it("returns 0 for null", () => {
    expect(countValue(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(countValue(undefined)).toBe(0);
  });

  it("returns 1 for a single value", () => {
    expect(countValue("hello")).toBe(1);
    expect(countValue(42)).toBe(1);
    expect(countValue({ a: 1 })).toBe(1);
  });

  it("returns length for arrays", () => {
    expect(countValue([1, 2, 3])).toBe(3);
    expect(countValue([])).toBe(0);
    expect(countValue(["single"])).toBe(1);
  });
});

describe("regression: repeated groups", () => {
  it("reports each count location once with no dupes", () => {
    const resource = {
      name: [
        { given: ["Alice"], family: "Smith" },
        { given: ["Bob"], family: "Jones" },
      ],
    };

    const results = resolvePathNodes(resource, ["name"]);
    const locations = results.map((r) =>
      formatLocation("Patient", r.pathWithIndices, "family")
    );

    const unique = new Set(locations);
    expect(unique.size).toBe(locations.length);
    expect(locations).toEqual([
      "Patient.name[0].family",
      "Patient.name[1].family",
    ]);
  });
});
