import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";
import { applyPatch, PatchError } from "../../src/fhir/patch.ts";

const PROTOTYPE_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));
const safeKeyArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/).filter(k => !PROTOTYPE_KEYS.has(k));
const escapableKeyArb = fc.oneof(
  safeKeyArb,
  fc.stringMatching(/^[A-Za-z0-9_-]*[~\/][A-Za-z0-9_-]*$/).filter(k => !PROTOTYPE_KEYS.has(k)),
);

describe("JSON Patch Laws", () => {
  describe("pointer escaping round-trip", () => {
    it("add with escaped path, read back equals original value", () => {
      fc.assert(
        fc.property(
          fc.record({}),
          escapableKeyArb,
          fc.jsonValue(),
          (doc, key, value) => {
            const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
            const result = applyPatch(doc, [{ op: "add", path: `/${escaped}`, value }]);
            expect(result[key]).toEqual(value);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("add/remove identity", () => {
    it("add then remove is identity for object keys", () => {
      fc.assert(
        fc.property(
          fc.dictionary(safeKeyArb, fc.jsonValue()),
          safeKeyArb,
          fc.jsonValue(),
          (doc, key, value) => {
            fc.pre(!(key in doc));
            const expected = JSON.parse(JSON.stringify(doc));
            const added = applyPatch(doc, [{ op: "add", path: `/${key}`, value }]);
            const removed = applyPatch(added, [{ op: "remove", path: `/${key}` }]);
            expect(removed).toEqual(expected);
          }
        ),
        { numRuns: 500 }
      );
    });

    it("add then remove is identity for array elements", () => {
      fc.assert(
        fc.property(
          fc.array(fc.jsonValue()),
          fc.jsonValue(),
          fc.integer({ min: 0, max: 100 }),
          (arr, value, idx) => {
            const safeIdx = idx % (arr.length + 1);
            const expected = JSON.parse(JSON.stringify(arr));
            const added = applyPatch(arr, [{ op: "add", path: `/${safeIdx}`, value }]);
            const removed = applyPatch(added, [{ op: "remove", path: `/${safeIdx}` }]);
            expect(removed).toEqual(expected);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("copy semantics", () => {
    it("copy deep-equals source", () => {
      fc.assert(
        fc.property(
          fc.dictionary(safeKeyArb, fc.jsonValue()),
          safeKeyArb,
          safeKeyArb,
          (doc, from, to) => {
            fc.pre(from !== to);
            fc.pre(!(from in doc));
            const withFrom = { ...doc, [from]: { nested: "value" } };
            const result = applyPatch(withFrom, [{ op: "copy", from: `/${from}`, path: `/${to}` }]);
            expect(result[to]).toEqual(result[from]);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("move semantics", () => {
    it("move preserves value", () => {
      fc.assert(
        fc.property(
          fc.dictionary(safeKeyArb, fc.jsonValue()),
          safeKeyArb,
          safeKeyArb,
          (doc, from, to) => {
            fc.pre(from !== to);
            fc.pre(!(from in doc));
            const withFrom = { ...doc, [from]: { nested: "value" } };
            const result = applyPatch(withFrom, [{ op: "move", from: `/${from}`, path: `/${to}` }]);
            expect(result[to]).toEqual({ nested: "value" });
            expect(result[from]).toBeUndefined();
          }
        ),
        { numRuns: 500 }
      );
    });

    it("move preserves value multiset", () => {
      fc.assert(
        fc.property(
          fc.dictionary(safeKeyArb, fc.jsonValue()),
          safeKeyArb,
          safeKeyArb,
          (doc, from, to) => {
            fc.pre(from !== to);
            fc.pre(!(from in doc));
            const withFrom = { ...doc, [from]: "unique" };
            const result = applyPatch(withFrom, [{ op: "move", from: `/${from}`, path: `/${to}` }]);
            const values = Object.values(result);
            const count = values.filter(v => v === "unique").length;
            expect(count).toBe(1);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("test op as oracle", () => {
    it("test with matching path passes iff deep-equal", () => {
      fc.assert(
        fc.property(
          safeKeyArb,
          fc.jsonValue(),
          fc.jsonValue(),
          (key, a, b) => {
            const doc = { [key]: a };
            const testOp = { op: "test" as const, path: `/${key}`, value: b };
            if (JSON.stringify(a) === JSON.stringify(b)) {
              expect(() => applyPatch(doc, [testOp])).not.toThrow();
            } else {
              expect(() => applyPatch(doc, [testOp])).toThrow();
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe("never throws TypeError", () => {
    it("only throws PatchError on arbitrary docs + ops with safe paths", () => {
      fc.assert(
        fc.property(
          fc.jsonValue(),
          fc.array(
            fc.record({
              op: fc.constantFrom("add", "remove", "replace", "move", "copy", "test"),
              path: fc.option(safeKeyArb.map(k => `/${k}`), { nil: "" }),
              value: fc.option(fc.jsonValue()),
              from: fc.option(safeKeyArb.map(k => `/${k}`)),
            })
          ),
          (doc, ops) => {
            try {
              applyPatch(doc as Record<string, unknown>, ops);
            } catch (e) {
              expect(e).toBeInstanceOf(PatchError);
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
