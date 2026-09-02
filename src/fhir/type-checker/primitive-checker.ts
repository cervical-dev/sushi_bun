import type { StructureDefinitionElement, ValidationIssue } from "../types.ts";

const KNOWN_PRIMITIVE_TYPES = new Set([
  "string", "boolean", "integer", "decimal", "uri", "url", "canonical",
  "id", "date", "dateTime", "instant", "time", "positiveInt", "unsignedInt",
  "base64Binary", "oid", "uuid", "code",
]);

function isInteger(n: number): boolean {
  return Number.isInteger(n);
}

function matchesDate(s: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s);
}

function matchesDateTime(s: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2})?)?(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(s);
}

function matchesInstant(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s);
}

function matchesTime(s: string): boolean {
  return /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
}

function matchesId(s: string): boolean {
  return /^[A-Za-z0-9\-\.]{1,64}$/.test(s);
}

export function validatePrimitive(
  value: unknown,
  element: StructureDefinitionElement
): ValidationIssue[] {
  const typeCode = element.type?.[0]?.code;
  if (!typeCode) return [];

  if (value === null || value === undefined) {
    return [{
      severity: "error",
      code: "invalid-type",
      diagnostics: `Expected ${typeCode}, got null`,
      location: element.path,
    }];
  }

  const baseType = typeCode === "code" ? "string" : typeCode;
  const expected = typeCode;

  switch (baseType) {
    case "string":
    case "uri":
    case "url":
    case "canonical": {
      if (typeof value !== "string") {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      if (typeCode === "uri" || typeCode === "url" || typeCode === "canonical") {
        if (value === "") {
          return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got empty string`, location: element.path }];
        }
      }
      return [];
    }

    case "boolean": {
      if (typeof value !== "boolean") {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "integer": {
      if (typeof value !== "number" || !isInteger(value)) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "decimal": {
      if (typeof value !== "number") {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "positiveInt": {
      if (typeof value !== "number" || !isInteger(value) || value < 1) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected} (>= 1), got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "unsignedInt": {
      if (typeof value !== "number" || !isInteger(value) || value < 0) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected} (>= 0), got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "date": {
      if (typeof value !== "string" || !matchesDate(value)) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected} (YYYY, YYYY-MM, or YYYY-MM-DD), got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "dateTime": {
      if (typeof value !== "string" || !matchesDateTime(value)) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "instant": {
      if (typeof value !== "string" || !matchesInstant(value)) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "time": {
      if (typeof value !== "string" || !matchesTime(value)) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "id": {
      if (typeof value !== "string" || !matchesId(value)) {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected} (1-64 alphanumeric/dash/dot), got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    case "base64Binary":
    case "oid":
    case "uuid": {
      if (typeof value !== "string") {
        return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
      }
      return [];
    }

    default: {
      if (KNOWN_PRIMITIVE_TYPES.has(typeCode)) {
        if (typeof value !== "string") {
          return [{ severity: "error", code: "invalid-type", diagnostics: `Expected ${expected}, got ${jsonType(value)}`, location: element.path }];
        }
        return [];
      }
      return [];
    }
  }
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
