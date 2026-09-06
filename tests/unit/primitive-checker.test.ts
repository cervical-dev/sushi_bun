import { describe, it, expect } from "bun:test";
import { validatePrimitive } from "../../src/fhir/type-checker/primitive-checker.ts";
import type { StructureDefinitionElement } from "../../src/fhir/types.ts";

function elementWithType(typeCode: string, opts?: Partial<StructureDefinitionElement>): StructureDefinitionElement {
  return {
    id: `test.${typeCode}`,
    path: `Resource.${typeCode}`,
    type: [{ code: typeCode }],
    ...opts,
  };
}

describe("validatePrimitive", () => {
  describe("string type (FHIR Spec §2.6.1)", () => {
    const el = elementWithType("string");

    it("accepts a plain string", () => {
      expect(validatePrimitive("hello", el)).toHaveLength(0);
    });

    it("accepts empty string", () => {
      expect(validatePrimitive("", el)).toHaveLength(0);
    });

    it("accepts unicode string", () => {
      expect(validatePrimitive("日本語テスト", el)).toHaveLength(0);
    });

    it("rejects a number", () => {
      const issues = validatePrimitive(42, el);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("invalid-type");
      expect(issues[0]!.diagnostics).toContain("string");
    });

    it("rejects a boolean", () => {
      expect(validatePrimitive(true, el)).toHaveLength(1);
      expect(validatePrimitive(false, el)).toHaveLength(1);
    });

    it("rejects an object", () => {
      expect(validatePrimitive({ nested: true }, el)).toHaveLength(1);
    });

    it("rejects an array", () => {
      expect(validatePrimitive(["a", "b"], el)).toHaveLength(1);
    });

    it("rejects null", () => {
      expect(validatePrimitive(null, el)).toHaveLength(1);
    });
  });

  describe("boolean type", () => {
    const el = elementWithType("boolean");

    it("accepts true", () => {
      expect(validatePrimitive(true, el)).toHaveLength(0);
    });

    it("accepts false", () => {
      expect(validatePrimitive(false, el)).toHaveLength(0);
    });

    it("rejects string 'true'", () => {
      const issues = validatePrimitive("true", el);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("invalid-type");
    });

    it("rejects number 1", () => {
      expect(validatePrimitive(1, el)).toHaveLength(1);
    });

    it("rejects null", () => {
      expect(validatePrimitive(null, el)).toHaveLength(1);
    });
  });

  describe("integer type", () => {
    const el = elementWithType("integer");

    it("accepts zero", () => {
      expect(validatePrimitive(0, el)).toHaveLength(0);
    });

    it("accepts positive integer", () => {
      expect(validatePrimitive(42, el)).toHaveLength(0);
    });

    it("accepts negative integer", () => {
      expect(validatePrimitive(-7, el)).toHaveLength(0);
    });

    it("rejects float", () => {
      const issues = validatePrimitive(3.14, el);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("invalid-type");
      expect(issues[0]!.diagnostics).toContain("integer");
    });

    it("rejects string '42'", () => {
      expect(validatePrimitive("42", el)).toHaveLength(1);
    });

    it("rejects boolean", () => {
      expect(validatePrimitive(true, el)).toHaveLength(1);
    });
  });

  describe("decimal type", () => {
    const el = elementWithType("decimal");

    it("accepts integer (coerced to decimal)", () => {
      expect(validatePrimitive(42, el)).toHaveLength(0);
    });

    it("accepts float", () => {
      expect(validatePrimitive(3.14, el)).toHaveLength(0);
    });

    it("accepts negative decimal", () => {
      expect(validatePrimitive(-0.5, el)).toHaveLength(0);
    });

    it("rejects string", () => {
      expect(validatePrimitive("3.14", el)).toHaveLength(1);
    });

    it("rejects boolean", () => {
      expect(validatePrimitive(true, el)).toHaveLength(1);
    });
  });

  describe("uri type (FHIR Spec §2.6.2)", () => {
    const el = elementWithType("uri");

    it("accepts absolute http URI", () => {
      expect(validatePrimitive("http://example.com", el)).toHaveLength(0);
    });

    it("accepts https URI", () => {
      expect(validatePrimitive("https://hl7.org/fhir", el)).toHaveLength(0);
    });

    it("accepts urn", () => {
      expect(validatePrimitive("urn:oid:2.16.840.1.113883.4.642.1", el)).toHaveLength(0);
    });

    it("accepts relative URI", () => {
      expect(validatePrimitive("ValueSet/123", el)).toHaveLength(0);
    });

    it("rejects empty string for required URI", () => {
      const issues = validatePrimitive("", el);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("invalid-type");
    });

    it("rejects number", () => {
      expect(validatePrimitive(123, el)).toHaveLength(1);
    });
  });

  describe("url type", () => {
    const el = elementWithType("url");

    it("accepts absolute URL", () => {
      expect(validatePrimitive("http://example.com", el)).toHaveLength(0);
    });

    it("rejects empty string", () => {
      expect(validatePrimitive("", el)).toHaveLength(1);
    });
  });

  describe("canonical type", () => {
    const el = elementWithType("canonical");

    it("accepts canonical URL", () => {
      expect(validatePrimitive("http://hl7.org/fhir/StructureDefinition/Patient", el)).toHaveLength(0);
    });

    it("accepts canonical with version", () => {
      expect(validatePrimitive("http://hl7.org/fhir/StructureDefinition/Patient|4.0.1", el)).toHaveLength(0);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(123, el)).toHaveLength(1);
    });
  });

  describe("id type", () => {
    const el = elementWithType("id");

    it("accepts valid id (alphanumeric + dash + dot)", () => {
      expect(validatePrimitive("abc-123.def", el)).toHaveLength(0);
    });

    it("accepts simple id", () => {
      expect(validatePrimitive("my-patient-1", el)).toHaveLength(0);
    });

    it("rejects empty string", () => {
      expect(validatePrimitive("", el)).toHaveLength(1);
    });

    it("rejects id with spaces", () => {
      const issues = validatePrimitive("has spaces", el);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("invalid-type");
    });

    it("rejects id with special chars", () => {
      expect(validatePrimitive("id@#$", el)).toHaveLength(1);
    });
  });

  describe("date type (FHIR Spec §2.6.2.1)", () => {
    const el = elementWithType("date");

    it("accepts full date YYYY-MM-DD", () => {
      expect(validatePrimitive("1990-01-15", el)).toHaveLength(0);
    });

    it("accepts year-month YYYY-MM", () => {
      expect(validatePrimitive("1990-01", el)).toHaveLength(0);
    });

    it("accepts year only YYYY", () => {
      expect(validatePrimitive("1990", el)).toHaveLength(0);
    });

    it("rejects date without dashes", () => {
      expect(validatePrimitive("19900115", el)).toHaveLength(1);
    });

    it("rejects time component", () => {
      expect(validatePrimitive("1990-01-15T00:00:00", el)).toHaveLength(1);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(1990, el)).toHaveLength(1);
    });

    it("rejects month out of range", () => {
      expect(validatePrimitive("2020-13-01", el)).toHaveLength(1);
    });

    it("rejects day out of range", () => {
      expect(validatePrimitive("2020-01-99", el)).toHaveLength(1);
    });

    it("accepts month 12", () => {
      expect(validatePrimitive("2020-12-31", el)).toHaveLength(0);
    });
  });

  describe("dateTime type", () => {
    const el = elementWithType("dateTime");

    it("accepts full dateTime with timezone", () => {
      expect(validatePrimitive("2024-01-15T10:30:00Z", el)).toHaveLength(0);
    });

    it("accepts date-only dateTime", () => {
      expect(validatePrimitive("2024-01-15", el)).toHaveLength(0);
    });

    it("accepts dateTime with offset", () => {
      expect(validatePrimitive("2024-01-15T10:30:00+05:30", el)).toHaveLength(0);
    });

    it("rejects invalid format", () => {
      expect(validatePrimitive("January 15, 2024", el)).toHaveLength(1);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(2024, el)).toHaveLength(1);
    });
  });

  describe("instant type", () => {
    const el = elementWithType("instant");

    it("accepts instant with timezone", () => {
      expect(validatePrimitive("2024-01-15T10:30:00Z", el)).toHaveLength(0);
    });

    it("accepts instant with offset", () => {
      expect(validatePrimitive("2024-01-15T10:30:00+05:30", el)).toHaveLength(0);
    });

    it("rejects date without time", () => {
      expect(validatePrimitive("2024-01-15", el)).toHaveLength(1);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(Date.now(), el)).toHaveLength(1);
    });
  });

  describe("time type", () => {
    const el = elementWithType("time");

    it("accepts HH:MM:SS", () => {
      expect(validatePrimitive("10:30:00", el)).toHaveLength(0);
    });

    it("accepts HH:MM", () => {
      expect(validatePrimitive("10:30", el)).toHaveLength(0);
    });

    it("rejects date prefix", () => {
      expect(validatePrimitive("2024-01-15T10:30:00", el)).toHaveLength(1);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(1030, el)).toHaveLength(1);
    });

    it("rejects hour out of range", () => {
      expect(validatePrimitive("25:00:00", el)).toHaveLength(1);
    });

    it("rejects minute out of range", () => {
      expect(validatePrimitive("10:99:00", el)).toHaveLength(1);
    });

    it("rejects second out of range", () => {
      expect(validatePrimitive("10:30:99", el)).toHaveLength(1);
    });

    it("accepts midnight", () => {
      expect(validatePrimitive("00:00:00", el)).toHaveLength(0);
    });

    it("accepts end of day", () => {
      expect(validatePrimitive("23:59:59", el)).toHaveLength(0);
    });
  });

  describe("positiveInt type", () => {
    const el = elementWithType("positiveInt");

    it("accepts 1", () => {
      expect(validatePrimitive(1, el)).toHaveLength(0);
    });

    it("accepts 100", () => {
      expect(validatePrimitive(100, el)).toHaveLength(0);
    });

    it("rejects 0", () => {
      const issues = validatePrimitive(0, el);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("invalid-type");
      expect(issues[0]!.diagnostics).toContain("positive");
    });

    it("rejects negative", () => {
      expect(validatePrimitive(-1, el)).toHaveLength(1);
    });

    it("rejects float", () => {
      expect(validatePrimitive(1.5, el)).toHaveLength(1);
    });
  });

  describe("unsignedInt type", () => {
    const el = elementWithType("unsignedInt");

    it("accepts 0", () => {
      expect(validatePrimitive(0, el)).toHaveLength(0);
    });

    it("accepts 100", () => {
      expect(validatePrimitive(100, el)).toHaveLength(0);
    });

    it("rejects negative", () => {
      const issues = validatePrimitive(-1, el);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.diagnostics).toContain("unsigned");
    });

    it("rejects float", () => {
      expect(validatePrimitive(1.5, el)).toHaveLength(1);
    });
  });

  describe("base64Binary type", () => {
    const el = elementWithType("base64Binary");

    it("accepts valid base64 string", () => {
      expect(validatePrimitive("SGVsbG8gV29ybGQ=", el)).toHaveLength(0);
    });

    it("accepts empty base64", () => {
      expect(validatePrimitive("", el)).toHaveLength(0);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(123, el)).toHaveLength(1);
    });

    it("rejects invalid base64 characters", () => {
      expect(validatePrimitive("not-base64!!!", el)).toHaveLength(1);
    });
  });

  describe("oid type", () => {
    const el = elementWithType("oid");

    it("accepts valid OID", () => {
      expect(validatePrimitive("2.16.840.1.113883.4.642.1", el)).toHaveLength(0);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(123, el)).toHaveLength(1);
    });

    it("rejects OID without dot separator", () => {
      expect(validatePrimitive("not-an-oid", el)).toHaveLength(1);
    });

    it("rejects OID with leading dot", () => {
      expect(validatePrimitive(".2.16.840", el)).toHaveLength(1);
    });
  });

  describe("uuid type", () => {
    const el = elementWithType("uuid");

    it("accepts valid UUID", () => {
      expect(validatePrimitive("urn:uuid:12345678-1234-1234-1234-123456789012", el)).toHaveLength(0);
    });

    it("accepts bare UUID", () => {
      expect(validatePrimitive("12345678-1234-1234-1234-123456789012", el)).toHaveLength(0);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(123, el)).toHaveLength(1);
    });

    it("rejects invalid UUID format", () => {
      expect(validatePrimitive("nope", el)).toHaveLength(1);
    });
  });

  describe("code type (FHIR Spec §3.1.1.1)", () => {
    const el = elementWithType("code");

    it("accepts valid code string", () => {
      expect(validatePrimitive("final", el)).toHaveLength(0);
    });

    it("accepts empty code", () => {
      expect(validatePrimitive("", el)).toHaveLength(0);
    });

    it("rejects non-string", () => {
      expect(validatePrimitive(42, el)).toHaveLength(1);
    });
  });

  describe("no type specified (element has no type constraint)", () => {
    const el: StructureDefinitionElement = {
      id: "Resource.something",
      path: "Resource.something",
    };

    it("accepts any value when no type constraint", () => {
      expect(validatePrimitive("string", el)).toHaveLength(0);
      expect(validatePrimitive(42, el)).toHaveLength(0);
      expect(validatePrimitive(true, el)).toHaveLength(0);
      expect(validatePrimitive(null, el)).toHaveLength(0);
      expect(validatePrimitive({ a: 1 }, el)).toHaveLength(0);
      expect(validatePrimitive([1, 2], el)).toHaveLength(0);
    });
  });

  describe("unknown type code", () => {
    const el = elementWithType("FutureUnicornType");

    it("accepts any value for unrecognized type (forward compat)", () => {
      expect(validatePrimitive("anything", el)).toHaveLength(0);
      expect(validatePrimitive(42, el)).toHaveLength(0);
    });
  });
});
