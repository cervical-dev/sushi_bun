import { describe, it, expect } from "bun:test";
import { parseSearchParams, filtersToSqlFilters } from "../../src/router/params.ts";

describe("parseSearchParams", () => {
  const searchParams = new Map([
    ["name", { name: "name", type: "string" }],
    ["gender", { name: "gender", type: "token" }],
    ["birthdate", { name: "birthdate", type: "date" }],
    ["identifier", { name: "identifier", type: "token" }],
  ]);

  it("parses simple string params", () => {
    const filters = parseSearchParams("name=Smith", searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.parameter).toBe("name");
    expect(filters[0]!.value).toBe("Smith");
  });

  it("parses multiple params", () => {
    const filters = parseSearchParams("name=Smith&gender=male", searchParams);
    expect(filters.length).toBe(2);
  });

  it("parses date with prefix", () => {
    const filters = parseSearchParams("birthdate=ge2000-01-01", searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.parameter).toBe("birthdate");
    expect(filters[0]!.prefix).toBe("ge");
    expect(filters[0]!.value).toBe("2000-01-01");
  });

  it("ignores unknown parameters", () => {
    const filters = parseSearchParams("unknown=value&name=Smith", searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.parameter).toBe("name");
  });

  it("ignores underscore parameters", () => {
    const filters = parseSearchParams("_count=10&name=Smith", searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.parameter).toBe("name");
  });

  it("parses modifier", () => {
    const filters = parseSearchParams("name:contains=ith", searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.modifier).toBe("contains");
  });
});

describe("filtersToSqlFilters", () => {
  const searchParams = new Map([
    ["name", { name: "name", type: "string" }],
    ["gender", { name: "gender", type: "token" }],
    ["birthdate", { name: "birthdate", type: "date" }],
  ]);

  it("converts string filter to sql", () => {
    const filters = parseSearchParams("name=Smith", searchParams);
    const sqlFilters = filtersToSqlFilters(filters, searchParams);
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.column).toBe("json:$.name");
    expect(sqlFilters[0]!.op).toBe("LIKE");
  });

  it("converts token filter to sql", () => {
    const filters = parseSearchParams("gender=male", searchParams);
    const sqlFilters = filtersToSqlFilters(filters, searchParams);
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.column).toBe("json:$.gender");
  });

  it("converts date filter with prefix to sql", () => {
    const filters = parseSearchParams("birthdate=ge2000-01-01", searchParams);
    const sqlFilters = filtersToSqlFilters(filters, searchParams);
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.op).toBe(">=");
    expect(sqlFilters[0]!.value).toBe("2000-01-01");
  });
});
