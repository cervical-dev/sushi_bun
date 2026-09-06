import { describe, it, expect } from "bun:test";
import { applyPatch, PatchError } from "../../src/fhir/patch.ts";

describe("JSON Patch", () => {
  describe("pointer escaping", () => {
    it("unescapes ~1 to / in path", () => {
      const doc = { "a/b": 1 };
      const result = applyPatch(doc, [{ op: "replace", path: "/a~1b", value: 2 }]);
      expect(result).toEqual({ "a/b": 2 });
    });

    it("unescapes ~0 to ~ in path", () => {
      const doc = { "a~b": 1 };
      const result = applyPatch(doc, [{ op: "replace", path: "/a~0b", value: 2 }]);
      expect(result).toEqual({ "a~b": 2 });
    });

    it("unescapes ~0~1 combination", () => {
      const doc = { "a~/b/c": 1 };
      const result = applyPatch(doc, [{ op: "replace", path: "/a~0~1b~1c", value: 2 }]);
      expect(result).toEqual({ "a~/b/c": 2 });
    });
  });

  describe("add", () => {
    it("adds to object", () => {
      const result = applyPatch({ a: 1 }, [{ op: "add", path: "/b", value: 2 }]);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("appends to array with -", () => {
      const result = applyPatch({ a: [1, 2] }, [{ op: "add", path: "/a/-", value: 3 }]);
      expect(result).toEqual({ a: [1, 2, 3] });
    });

    it("inserts into array at index", () => {
      const result = applyPatch({ a: [1, 3] }, [{ op: "add", path: "/a/1", value: 2 }]);
      expect(result).toEqual({ a: [1, 2, 3] });
    });

    it("auto-creates intermediate objects for add", () => {
      const result = applyPatch({ a: 1 }, [{ op: "add", path: "/b/c", value: 2 }]);
      expect(result).toEqual({ a: 1, b: { c: 2 } });
    });

    it("auto-creates array when numeric index in path", () => {
      const result = applyPatch({}, [{ op: "add", path: "/a/0/b", value: 1 }]);
      expect(result).toEqual({ a: [{ b: 1 }] });
    });
  });

  describe("remove", () => {
    it("removes from object", () => {
      const result = applyPatch({ a: 1, b: 2 }, [{ op: "remove", path: "/b" }]);
      expect(result).toEqual({ a: 1 });
    });

    it("removes from array by index", () => {
      const result = applyPatch({ a: [1, 2, 3] }, [{ op: "remove", path: "/a/1" }]);
      expect(result).toEqual({ a: [1, 3] });
    });

    it("fails when target does not exist", () => {
      expect(() => applyPatch({ a: 1 }, [{ op: "remove", path: "/b" }])).toThrow(PatchError);
    });

    it("fails on missing intermediate path", () => {
      expect(() => applyPatch({ a: 1 }, [{ op: "remove", path: "/b/c" }])).toThrow(PatchError);
    });

    it("fails when path is - on array", () => {
      expect(() => applyPatch({ a: [1, 2] }, [{ op: "remove", path: "/a/-" }])).toThrow(PatchError);
    });
  });

  describe("replace", () => {
    it("replaces existing value", () => {
      const result = applyPatch({ a: 1 }, [{ op: "replace", path: "/a", value: 2 }]);
      expect(result).toEqual({ a: 2 });
    });

    it("replaces in nested object", () => {
      const result = applyPatch({ a: { b: 1 } }, [{ op: "replace", path: "/a/b", value: 2 }]);
      expect(result).toEqual({ a: { b: 2 } });
    });

    it("replaces array element", () => {
      const result = applyPatch({ a: [1, 2, 3] }, [{ op: "replace", path: "/a/1", value: 99 }]);
      expect(result).toEqual({ a: [1, 99, 3] });
    });

    it("fails when target does not exist", () => {
      expect(() => applyPatch({ a: 1 }, [{ op: "replace", path: "/b", value: 2 }])).toThrow(PatchError);
    });

    it("does not auto-create missing parents", () => {
      expect(() => applyPatch({ a: 1 }, [{ op: "replace", path: "/b/c", value: 2 }])).toThrow(PatchError);
    });

    it("fails when path is - on array", () => {
      expect(() => applyPatch({ a: [1, 2] }, [{ op: "replace", path: "/a/-", value: 3 }])).toThrow(PatchError);
    });
  });

  describe("move", () => {
    it("moves value", () => {
      const result = applyPatch({ a: { b: 1, c: 2 } }, [
        { op: "move", from: "/a/b", path: "/a/d" },
      ]);
      expect(result).toEqual({ a: { c: 2, d: 1 } });
    });

    it("moves forward within same array", () => {
      const result = applyPatch({ a: [1, 2, 3, 4] }, [
        { op: "move", from: "/a/1", path: "/a/3" },
      ]);
      expect(result).toEqual({ a: [1, 3, 4, 2] });
    });

    it("moves backward within same array", () => {
      const result = applyPatch({ a: [1, 2, 3] }, [
        { op: "move", from: "/a/2", path: "/a/0" },
      ]);
      expect(result).toEqual({ a: [3, 1, 2] });
    });

    it("fails when source does not exist", () => {
      expect(() => applyPatch({ a: 1 }, [{ op: "move", from: "/b", path: "/c" }])).toThrow(PatchError);
    });
  });

  describe("copy", () => {
    it("copies value", () => {
      const result = applyPatch({ a: { b: 1 } }, [
        { op: "copy", from: "/a/b", path: "/a/c" },
      ]);
      expect(result).toEqual({ a: { b: 1, c: 1 } });
    });

    it("deep copies objects", () => {
      const result = applyPatch({ a: { b: { c: 1 } } }, [
        { op: "copy", from: "/a/b", path: "/a/d" },
      ]);
      expect((result as any).a.b).not.toBe((result as any).a.d);
      expect((result as any).a.d).toEqual({ c: 1 });
    });
  });

  describe("test", () => {
    it("passes when value matches", () => {
      const doc = { a: 1 };
      expect(() => applyPatch(doc, [{ op: "test", path: "/a", value: 1 }])).not.toThrow();
    });

    it("fails when value does not match", () => {
      const doc = { a: 1 };
      expect(() => applyPatch(doc, [{ op: "test", path: "/a", value: 2 }])).toThrow(PatchError);
    });

    it("fails when path is - on array", () => {
      expect(() => applyPatch({ a: [1, 2] }, [{ op: "test", path: "/a/-", value: [1, 2] }])).toThrow(PatchError);
    });
  });

  describe("unsupported ops", () => {
    it("throws on unknown operation", () => {
      expect(() => applyPatch({ a: 1 }, [{ op: "invalid", path: "/a" }])).toThrow(PatchError);
    });
  });

  describe("FHIR resource patching", () => {
    it("patches patient name", () => {
      const patient = { resourceType: "Patient", name: [{ family: "Smith", given: ["John"] }] };
      const result = applyPatch(patient, [{ op: "replace", path: "/name/0/family", value: "Jones" }]);
      expect((result as any).name[0].family).toBe("Jones");
    });

    it("adds identifier", () => {
      const patient = { resourceType: "Patient", name: [] };
      const result = applyPatch(patient, [
        { op: "add", path: "/identifier/-", value: { system: "http://example.org", value: "123" } },
      ]);
      expect(result.identifier).toEqual([{ system: "http://example.org", value: "123" }]);
    });
  });
});
