import { describe, it, expect } from "bun:test";
import { parseCapabilityStatement } from "../../src/fhir/capability.ts";

describe("parseCapabilityStatement", () => {
  it("parses a valid capability statement", () => {
    const cap = {
      resourceType: "CapabilityStatement" as const,
      rest: [
        {
          mode: "server",
          resource: [
            {
              type: "Patient",
              interaction: [{ code: "read" }, { code: "search-type" }],
              searchParam: [{ name: "name", type: "string" }],
            },
          ],
          interaction: [{ code: "transaction" }],
        },
      ],
    };

    const config = parseCapabilityStatement(cap);

    expect(config.resources.has("Patient")).toBe(true);
    expect(config.resources.get("Patient")!.interactions.has("read")).toBe(true);
    expect(config.resources.get("Patient")!.interactions.has("search-type")).toBe(true);
    expect(config.resources.get("Patient")!.searchParams.has("name")).toBe(true);
    expect(config.systemInteractions.has("transaction")).toBe(true);
  });

  it("throws if no server rest entry", () => {
    const cap = {
      resourceType: "CapabilityStatement" as const,
      rest: [{ mode: "client" }],
    };

    expect(() => parseCapabilityStatement(cap)).toThrow("no server rest entry");
  });

  it("handles missing interactions gracefully", () => {
    const cap = {
      resourceType: "CapabilityStatement" as const,
      rest: [
        {
          mode: "server",
          resource: [{ type: "Patient" }],
        },
      ],
    };

    const config = parseCapabilityStatement(cap);
    expect(config.resources.get("Patient")!.interactions.size).toBe(0);
  });

  it("parses all search parameter types", () => {
    const cap = {
      resourceType: "CapabilityStatement" as const,
      rest: [
        {
          mode: "server",
          resource: [
            {
              type: "Patient",
              searchParam: [
                { name: "name", type: "string" },
                { name: "gender", type: "token" },
                { name: "birthdate", type: "date" },
              ],
            },
          ],
        },
      ],
    };

    const config = parseCapabilityStatement(cap);
    const params = config.resources.get("Patient")!.searchParams;
    expect(params.get("name")!.type).toBe("string");
    expect(params.get("gender")!.type).toBe("token");
    expect(params.get("birthdate")!.type).toBe("date");
  });

  it("only outputs handler-relevant fields on ResourceConfig", () => {
    const cap = {
      resourceType: "CapabilityStatement" as const,
      rest: [
        {
          mode: "server",
          resource: [
            {
              type: "Patient",
              interaction: [{ code: "read" }],
              searchParam: [{ name: "name", type: "string" }],
              operation: [{ name: "everything", definition: "op" }],
              updateCreate: true,
            },
          ],
        },
      ],
    };

    const config = parseCapabilityStatement(cap);
    const rc = config.resources.get("Patient")!;

    const keys = Object.keys(rc).sort();
    expect(keys).toEqual([
      "interactions",
      "operations",
      "searchParams",
      "type",
      "updateCreate",
    ]);

    expect(rc.updateCreate).toBe(true);
  });

  it("defaults updateCreate to false", () => {
    const cap = {
      resourceType: "CapabilityStatement" as const,
      rest: [{ mode: "server", resource: [{ type: "Patient" }] }],
    };

    const config = parseCapabilityStatement(cap);
    expect(config.resources.get("Patient")!.updateCreate).toBe(false);
  });

  it("does not include documentation or definition on SearchParamConfig", () => {
    const cap = {
      resourceType: "CapabilityStatement" as const,
      rest: [
        {
          mode: "server",
          resource: [
            {
              type: "Patient",
              searchParam: [{ name: "name", type: "string", documentation: "The name", definition: "http://example.org" }],
            },
          ],
        },
      ],
    };

    const config = parseCapabilityStatement(cap);
    const param = config.resources.get("Patient")!.searchParams.get("name")!;
    const paramKeys = Object.keys(param).sort();
    expect(paramKeys).toEqual(["name", "type"]);
  });
});
