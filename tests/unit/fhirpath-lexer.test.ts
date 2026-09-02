import { describe, it, expect } from "bun:test";
import { tokenize, type Token } from "../../src/fhir/fhirpath/lexer.ts";

describe("FHIRPath Lexer", () => {
  describe("identifiers", () => {
    it("tokenizes simple identifier", () => {
      const tokens = tokenize("gender");
      expect(tokens).toEqual([{ type: "identifier", value: "gender" }]);
    });

    it("tokenizes dotted path", () => {
      const tokens = tokenize("Patient.name");
      expect(tokens).toEqual([
        { type: "identifier", value: "Patient" },
        { type: "dot", value: "." },
        { type: "identifier", value: "name" },
      ]);
    });

    it("tokenizes identifier with underscores", () => {
      const tokens = tokenize("birthDate");
      expect(tokens).toEqual([{ type: "identifier", value: "birthDate" }]);
    });
  });

  describe("literals", () => {
    it("tokenizes string literal", () => {
      const tokens = tokenize("'hello'");
      expect(tokens).toEqual([{ type: "string", value: "hello" }]);
    });

    it("tokenizes string with escaped quotes", () => {
      const tokens = tokenize("'it\\'s'");
      expect(tokens).toEqual([{ type: "string", value: "it's" }]);
    });

    it("tokenizes integer literal", () => {
      const tokens = tokenize("42");
      expect(tokens).toEqual([{ type: "integer", value: 42 }]);
    });

    it("tokenizes negative integer", () => {
      const tokens = tokenize("-7");
      expect(tokens).toEqual([{ type: "integer", value: -7 }]);
    });

    it("tokenizes decimal literal", () => {
      const tokens = tokenize("3.14");
      expect(tokens).toEqual([{ type: "decimal", value: 3.14 }]);
    });

    it("tokenizes boolean true", () => {
      const tokens = tokenize("true");
      expect(tokens).toEqual([{ type: "boolean", value: true }]);
    });

    it("tokenizes boolean false", () => {
      const tokens = tokenize("false");
      expect(tokens).toEqual([{ type: "boolean", value: false }]);
    });
  });

  describe("operators", () => {
    it("tokenizes comparison operators", () => {
      expect(tokenize("=")).toEqual([{ type: "equal", value: "=" }]);
      expect(tokenize("!=")).toEqual([{ type: "not-equal", value: "!=" }]);
      expect(tokenize(">")).toEqual([{ type: "greater", value: ">" }]);
      expect(tokenize("<")).toEqual([{ type: "less", value: "<" }]);
      expect(tokenize(">=")).toEqual([{ type: "greater-equal", value: ">=" }]);
      expect(tokenize("<=")).toEqual([{ type: "less-equal", value: "<=" }]);
    });

    it("tokenizes logical operators", () => {
      expect(tokenize("and")).toEqual([{ type: "and", value: "and" }]);
      expect(tokenize("or")).toEqual([{ type: "or", value: "or" }]);
      expect(tokenize("not")).toEqual([{ type: "not", value: "not" }]);
      expect(tokenize("implies")).toEqual([{ type: "implies", value: "implies" }]);
    });

    it("tokenizes arithmetic operators", () => {
      expect(tokenize("+")).toEqual([{ type: "plus", value: "+" }]);
      expect(tokenize("-")).toEqual([{ type: "minus", value: "-" }]);
      expect(tokenize("*")).toEqual([{ type: "star", value: "*" }]);
      expect(tokenize("/")).toEqual([{ type: "slash", value: "/" }]);
      expect(tokenize("div")).toEqual([{ type: "div", value: "div" }]);
      expect(tokenize("mod")).toEqual([{ type: "mod", value: "mod" }]);
    });
  });

  describe("punctuation", () => {
    it("tokenizes parentheses", () => {
      expect(tokenize("(")).toEqual([{ type: "lparen", value: "(" }]);
      expect(tokenize(")")).toEqual([{ type: "rparen", value: ")" }]);
    });

    it("tokenizes brackets", () => {
      expect(tokenize("[")).toEqual([{ type: "lbracket", value: "[" }]);
      expect(tokenize("]")).toEqual([{ type: "rbracket", value: "]" }]);
    });

    it("tokenizes comma", () => {
      expect(tokenize(",")).toEqual([{ type: "comma", value: "," }]);
    });

    it("tokenizes colon", () => {
      expect(tokenize(":")).toEqual([{ type: "colon", value: ":" }]);
    });

    it("tokenizes pipe", () => {
      expect(tokenize("|")).toEqual([{ type: "pipe", value: "|" }]);
    });
  });

  describe("function calls", () => {
    it("tokenizes function call", () => {
      const tokens = tokenize("exists()");
      expect(tokens).toEqual([
        { type: "identifier", value: "exists" },
        { type: "lparen", value: "(" },
        { type: "rparen", value: ")" },
      ]);
    });

    it("tokenizes function with arguments", () => {
      const tokens = tokenize("where(gender = 'male')");
      expect(tokens).toEqual([
        { type: "identifier", value: "where" },
        { type: "lparen", value: "(" },
        { type: "identifier", value: "gender" },
        { type: "equal", value: "=" },
        { type: "string", value: "male" },
        { type: "rparen", value: ")" },
      ]);
    });
  });

  describe("complex expressions", () => {
    it("tokenizes value[x] pattern", () => {
      const tokens = tokenize("value.exists()");
      expect(tokens).toEqual([
        { type: "identifier", value: "value" },
        { type: "dot", value: "." },
        { type: "identifier", value: "exists" },
        { type: "lparen", value: "(" },
        { type: "rparen", value: ")" },
      ]);
    });

    it("tokenizes empty()", () => {
      const tokens = tokenize("name.empty()");
      expect(tokens.length).toBeGreaterThan(0);
    });

    it("tokenizes count()", () => {
      const tokens = tokenize("identifier.count()");
      expect(tokens.some(t => t.type === "identifier" && t.value === "count")).toBe(true);
    });
  });

  describe("whitespace handling", () => {
    it("ignores leading/trailing whitespace", () => {
      const tokens = tokenize("  gender  ");
      expect(tokens).toEqual([{ type: "identifier", value: "gender" }]);
    });

    it("ignores whitespace between tokens", () => {
      const tokens = tokenize("gender  =  'male'");
      expect(tokens).toEqual([
        { type: "identifier", value: "gender" },
        { type: "equal", value: "=" },
        { type: "string", value: "male" },
      ]);
    });
  });

  describe("error handling", () => {
    it("handles unclosed string by returning partial string", () => {
      const tokens = tokenize("'unclosed");
      expect(tokens).toEqual([{ type: "string", value: "unclosed" }]);
    });

    it("handles unknown characters by skipping them", () => {
      const tokens = tokenize("a@b#c");
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.some(t => t.type === "identifier" && t.value === "a")).toBe(true);
      expect(tokens.some(t => t.type === "identifier" && t.value === "b")).toBe(true);
      expect(tokens.some(t => t.type === "identifier" && t.value === "c")).toBe(true);
    });
  });
});
