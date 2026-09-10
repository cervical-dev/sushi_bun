import { describe, it, expect } from "bun:test";
import { parseSearchParams, parsePaging } from "../../src/router/params.ts";
import { sqliteFilterTranslator } from "../../src/store/sqlite-provider.ts";

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

  it("splits comma-separated values into multiple filters", () => {
    const filters = parseSearchParams("name=Smith,Jones", searchParams);
    expect(filters.length).toBe(2);
    expect(filters[0]!.value).toBe("Smith");
    expect(filters[1]!.value).toBe("Jones");
  });

  it("parses sa prefix for date", () => {
    const filters = parseSearchParams("birthdate=sa2020-01-01", searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.prefix).toBe("sa");
    expect(filters[0]!.value).toBe("2020-01-01");
  });

  it("parses eb prefix for date", () => {
    const filters = parseSearchParams("birthdate=eb2020-01-01", searchParams);
    expect(filters.length).toBe(1);
    expect(filters[0]!.prefix).toBe("eb");
    expect(filters[0]!.value).toBe("2020-01-01");
  });
});

describe("parsePaging", () => {
  it("returns defaults when no params given", () => {
    const sp = new URLSearchParams();
    expect(parsePaging(sp)).toEqual({ count: 20, offset: 0 });
  });

  it("parses _count and _offset", () => {
    const sp = new URLSearchParams("_count=10&_offset=5");
    expect(parsePaging(sp)).toEqual({ count: 10, offset: 5 });
  });

  it("clamps _count to 100 max", () => {
    const sp = new URLSearchParams("_count=500");
    expect(parsePaging(sp).count).toBe(100);
  });

  it("clamps _count to 0 min", () => {
    const sp = new URLSearchParams("_count=-5");
    expect(parsePaging(sp).count).toBe(0);
  });

  it("defaults _count to 20 on NaN", () => {
    const sp = new URLSearchParams("_count=abc");
    expect(parsePaging(sp).count).toBe(20);
  });

  it("floors negative _offset to 0", () => {
    const sp = new URLSearchParams("_offset=-10");
    expect(parsePaging(sp).offset).toBe(0);
  });

  it("floors non-numeric _offset to 0", () => {
    const sp = new URLSearchParams("_offset=xyz");
    expect(parsePaging(sp).offset).toBe(0);
  });
});

describe("sqliteFilterTranslator", () => {
  const searchParams = new Map([
    ["name", { name: "name", type: "string", jsonPath: "$.name", searchPath: "$.name" }],
    ["gender", { name: "gender", type: "token", jsonPath: "$.gender", searchPath: "$.gender" }],
    ["birthdate", { name: "birthdate", type: "date", jsonPath: "$.birthDate", searchPath: "$.birthDate" }],
    ["code", { name: "code", type: "token", jsonPath: "$.code", searchPath: "$.code.coding" }],
  ]);

  it("converts string filter to substring match", () => {
    const filters = parseSearchParams("name=Smith", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.column).toBe("json:$.name");
    expect(sqlFilters[0]!.op).toBe("LIKE");
    expect(sqlFilters[0]!.value).toBe("%Smith%");
  });

  it("converts string filter with :contains to substring match", () => {
    const filters = parseSearchParams("name:contains=ith", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.column).toBe("json:$.name");
    expect(sqlFilters[0]!.op).toBe("LIKE");
    expect(sqlFilters[0]!.value).toBe("%ith%");
  });

  it("converts simple token filter to exact match", () => {
    const filters = parseSearchParams("gender=male", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.column).toBe("json:$.gender");
    expect(sqlFilters[0]!.op).toBe("=");
    expect(sqlFilters[0]!.value).toBe("male");
  });

  it("converts CodeableConcept token filter to LIKE on coding array", () => {
    const filters = parseSearchParams("code=8867-4", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.column).toBe("json:$.code.coding");
    expect(sqlFilters[0]!.op).toBe("LIKE");
    expect(sqlFilters[0]!.value).toBe("%\"code\":\"8867-4\"%");
  });

  it("converts date filter with prefix to sql", () => {
    const filters = parseSearchParams("birthdate=ge2000-01-01", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.op).toBe(">=");
    expect(sqlFilters[0]!.value).toBe("2000-01-01");
  });

  it("converts sa prefix to greater-than operator", () => {
    const filters = parseSearchParams("birthdate=sa2020-01-01", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.op).toBe(">");
  });

  it("converts eb prefix to less-than operator", () => {
    const filters = parseSearchParams("birthdate=eb2020-01-01", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.op).toBe("<");
  });

  it("produces OR for comma-separated values on same column", () => {
    const filters = parseSearchParams("name=Smith,Jones", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(2);
    expect(sqlFilters[0]!.column).toBe(sqlFilters[1]!.column);
    expect(sqlFilters[0]!.value).toBe("%Smith%");
    expect(sqlFilters[1]!.value).toBe("%Jones%");
  });

  it("uses 'value' field for identifier pipe search", () => {
    const identifierParams = new Map([
      ["identifier", { name: "identifier", type: "token", jsonPath: "$.identifier", searchPath: "$.identifier" }],
    ]);
    const filters = parseSearchParams("identifier=http://example.org/mrn|12345", identifierParams);
    const sqlFilters = sqliteFilterTranslator(filters, identifierParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.op).toBe("LIKE");
    expect(sqlFilters[0]!.value).toContain('"value":"12345"');
    expect(sqlFilters[0]!.value).toContain('"system":"http://example.org/mrn"');
  });

  it("uses 'code' field for code pipe search", () => {
    const codeParams = new Map([
      ["code", { name: "code", type: "token", jsonPath: "$.code", searchPath: "$.code.coding" }],
    ]);
    const filters = parseSearchParams("code=http://loinc.org|8867-4", codeParams);
    const sqlFilters = sqliteFilterTranslator(filters, codeParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.op).toBe("LIKE");
    expect(sqlFilters[0]!.value).toContain('"code":"8867-4"');
    expect(sqlFilters[0]!.value).toContain('"system":"http://loinc.org"');
  });

  it("escapes backslash in string values", () => {
    const filters = parseSearchParams("name=path\\to\\file", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.value).toBe("%path\\\\to\\\\file%");
  });

  it("escapes percent in string values", () => {
    const filters = parseSearchParams("name=100%25", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.value).toBe("%100\\%%");
  });

  it("escapes underscore in string values", () => {
    const filters = parseSearchParams("name=hello_world", searchParams);
    const sqlFilters = sqliteFilterTranslator(filters, searchParams) as Array<{ column: string; op: string; value: string }>;
    expect(sqlFilters.length).toBe(1);
    expect(sqlFilters[0]!.value).toBe("%hello\\_world%");
  });
});
