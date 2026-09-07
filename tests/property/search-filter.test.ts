import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";
import { parseSearchParams } from "../../src/router/params.ts";
import type { SearchParamConfig } from "../../src/fhir/types.ts";

const searchParams = new Map<string, SearchParamConfig>([
  ["name", { name: "name", type: "string", searchPath: "$.name" }],
  ["family", { name: "family", type: "string", searchPath: "$.name.family" }],
  ["gender", { name: "gender", type: "token", searchPath: "$.gender" }],
  ["birthdate", { name: "birthdate", type: "date", searchPath: "$.birthDate" }],
  ["identifier", { name: "identifier", type: "token", searchPath: "$.identifier" }],
  ["patient", { name: "patient", type: "reference", searchPath: "$.subject" }],
]);

describe("Search Parameter Parsing Laws", () => {
  describe("string/token/reference comma-split", () => {
    it("comma-separated string values produce N filters", () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z]+$/), { minLength: 1, maxLength: 5 }),
          (values) => {
            const query = `name=${values.join(",")}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(values.length);
            for (const filter of filters) {
              expect(filter.parameter).toBe("name");
              expect(filter.value).toBeDefined();
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it("comma-separated token values produce N filters", () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom("male", "female", "other", "unknown"), { minLength: 1, maxLength: 4 }),
          (values) => {
            const query = `gender=${values.join(",")}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(values.length);
            for (const filter of filters) {
              expect(filter.parameter).toBe("gender");
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it("comma-separated reference values produce N filters", () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^Patient\/[a-z]+$/), { minLength: 1, maxLength: 3 }),
          (values) => {
            const query = `patient=${values.join(",")}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(values.length);
            for (const filter of filters) {
              expect(filter.parameter).toBe("patient");
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("date prefix parsing", () => {
    it("date prefix eq|ne|lt|gt|le|ge|sa|eb parsed correctly", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("eq", "ne", "lt", "gt", "le", "ge", "sa", "eb"),
          fc.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          (prefix, date) => {
            const query = `birthdate=${prefix}${date}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(1);
            expect(filters[0].prefix).toBe(prefix);
            expect(filters[0].value).toBe(date);
          }
        ),
        { numRuns: 500 }
      );
    });

    it("bare date defaults to eq prefix", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          (date) => {
            const query = `birthdate=${date}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(1);
            expect(filters[0].prefix).toBe("eq");
            expect(filters[0].value).toBe(date);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("unknown params", () => {
    it("unknown param is ignored", () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z]+$/),
          fc.string(),
          (unknownKey, value) => {
            fc.pre(!searchParams.has(unknownKey));
            const query = `${unknownKey}=${encodeURIComponent(value)}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(0);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("_count/_offset", () => {
    it("_count and _offset are ignored in filter parsing", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          (count, offset) => {
            const query = `_count=${count}&_offset=${offset}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(0);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("key:modifier preserved", () => {
    it("modifier is preserved in parsed filter", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("exact", "contains", "missing"),
          fc.stringMatching(/^[a-z]+$/),
          (modifier, value) => {
            const query = `name:${modifier}=${value}`;
            const filters = parseSearchParams(query, searchParams);
            expect(filters.length).toBe(1);
            expect(filters[0].modifier).toBe(modifier);
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
