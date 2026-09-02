import { describe, it, expect } from "bun:test";
import { parse, type AstNode } from "../../src/fhir/fhirpath/parser.ts";

describe("FHIRPath Parser", () => {
  describe("literals", () => {
    it("parses string literal", () => {
      const ast = parse("'hello'");
      expect(ast).toEqual({ type: "string", value: "hello" });
    });

    it("parses integer literal", () => {
      const ast = parse("42");
      expect(ast).toEqual({ type: "integer", value: 42 });
    });

    it("parses decimal literal", () => {
      const ast = parse("3.14");
      expect(ast).toEqual({ type: "decimal", value: 3.14 });
    });

    it("parses boolean true", () => {
      const ast = parse("true");
      expect(ast).toEqual({ type: "boolean", value: true });
    });

    it("parses boolean false", () => {
      const ast = parse("false");
      expect(ast).toEqual({ type: "boolean", value: false });
    });
  });

  describe("identifiers and paths", () => {
    it("parses single identifier", () => {
      const ast = parse("gender");
      expect(ast).toEqual({ type: "identifier", name: "gender" });
    });

    it("parses dotted path", () => {
      const ast = parse("Patient.name");
      expect(ast).toEqual({
        type: "path",
        parts: [
          { type: "identifier", name: "Patient" },
          { type: "identifier", name: "name" },
        ],
      });
    });

    it("parses deep dotted path", () => {
      const ast = parse("Patient.name.family");
      const path = ast as any;
      expect(path.type).toBe("path");
      expect(path.parts).toHaveLength(3);
      expect(path.parts[2].name).toBe("family");
    });
  });

  describe("comparison expressions", () => {
    it("parses equality", () => {
      const ast = parse("gender = 'male'") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("=");
      expect(ast.left.name).toBe("gender");
      expect(ast.right.value).toBe("male");
    });

    it("parses not equal", () => {
      const ast = parse("status != 'draft'") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("!=");
    });

    it("parses greater than", () => {
      const ast = parse("count > 0") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe(">");
    });

    it("parses less than or equal", () => {
      const ast = parse("value <= 100") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("<=");
    });
  });

  describe("logical expressions", () => {
    it("parses 'and'", () => {
      const ast = parse("active and verified") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("and");
    });

    it("parses 'or'", () => {
      const ast = parse("male or female") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("or");
    });

    it("parses 'not' prefix", () => {
      const ast = parse("not active") as any;
      expect(ast.type).toBe("unary");
      expect(ast.operator).toBe("not");
      expect(ast.operand.name).toBe("active");
    });

    it("parses 'implies'", () => {
      const ast = parse("value.exists() implies value > 0") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("implies");
    });
  });

  describe("function calls", () => {
    it("parses empty()", () => {
      const ast = parse("name.empty()") as any;
      expect(ast.type).toBe("function");
      expect(ast.name).toBe("empty");
      expect(ast.arguments).toHaveLength(0);
    });

    it("parses exists()", () => {
      const ast = parse("value.exists()") as any;
      expect(ast.type).toBe("function");
      expect(ast.name).toBe("exists");
    });

    it("parses where()", () => {
      const ast = parse("name.where(use = 'official')") as any;
      expect(ast.type).toBe("function");
      expect(ast.name).toBe("where");
      expect(ast.arguments).toHaveLength(1);
    });

    it("parses count()", () => {
      const ast = parse("identifier.count()") as any;
      expect(ast.type).toBe("function");
      expect(ast.name).toBe("count");
    });

    it("parses matches()", () => {
      const ast = parse("birthDate.matches('\\\\d{4}-\\\\d{2}-\\\\d{2}')") as any;
      expect(ast.type).toBe("function");
      expect(ast.name).toBe("matches");
      expect(ast.arguments).toHaveLength(1);
    });

    it("parses substring()", () => {
      const ast = parse("name.substring(0, 3)") as any;
      expect(ast.type).toBe("function");
      expect(ast.name).toBe("substring");
      expect(ast.arguments).toHaveLength(2);
    });
  });

  describe("operator precedence", () => {
    it("parses comparison before 'and'", () => {
      const ast = parse("a = 1 and b = 2") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("and");
      expect(ast.left.type).toBe("binary");
      expect(ast.left.operator).toBe("=");
      expect(ast.right.type).toBe("binary");
      expect(ast.right.operator).toBe("=");
    });

    it("parses 'and' before 'or'", () => {
      const ast = parse("a and b or c and d") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("or");
      expect(ast.left.operator).toBe("and");
      expect(ast.right.operator).toBe("and");
    });
  });

  describe("parenthesized expressions", () => {
    it("parses parenthesized expression", () => {
      const ast = parse("(gender = 'male')") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("=");
    });
  });

  describe("arithmetic expressions", () => {
    it("parses addition", () => {
      const ast = parse("a + b") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("+");
    });

    it("parses multiplication", () => {
      const ast = parse("a * b") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("*");
    });

    it("parses div", () => {
      const ast = parse("a div b") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("div");
    });
  });

  describe("pipe (union)", () => {
    it("parses pipe operator", () => {
      const ast = parse("a | b") as any;
      expect(ast.type).toBe("binary");
      expect(ast.operator).toBe("|");
    });
  });

  describe("error handling", () => {
    it("throws on empty expression", () => {
      expect(() => parse("")).toThrow();
    });

    it("throws on unmatched parentheses", () => {
      expect(() => parse("(gender = 'male'")).toThrow();
    });
  });
});
