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
});
