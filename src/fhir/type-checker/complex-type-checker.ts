import type { StructureDefinitionElement, ValidationIssue } from "../types.ts";

export function checkFixedValue(
  value: unknown,
  element: StructureDefinitionElement
): ValidationIssue[] {
  if (element.fixedCode !== undefined) {
    if (value !== element.fixedCode) {
      return [{
        severity: "error",
        code: "fixed-value",
        diagnostics: `Expected fixed value "${element.fixedCode}", got "${value}"`,
        location: element.path,
      }];
    }
    return [];
  }

  if (element.fixedBoolean !== undefined) {
    if (value !== element.fixedBoolean) {
      return [{
        severity: "error",
        code: "fixed-value",
        diagnostics: `Expected fixed value ${element.fixedBoolean}, got ${value}`,
        location: element.path,
      }];
    }
    return [];
  }

  if (element.fixedString !== undefined) {
    if (value !== element.fixedString) {
      return [{
        severity: "error",
        code: "fixed-value",
        diagnostics: `Expected fixed value "${element.fixedString}", got "${value}"`,
        location: element.path,
      }];
    }
    return [];
  }

  if (element.fixedUri !== undefined) {
    if (value !== element.fixedUri) {
      return [{
        severity: "error",
        code: "fixed-value",
        diagnostics: `Expected fixed value "${element.fixedUri}", got "${value}"`,
        location: element.path,
      }];
    }
    return [];
  }

  if (element.fixedId !== undefined) {
    if (value !== element.fixedId) {
      return [{
        severity: "error",
        code: "fixed-value",
        diagnostics: `Expected fixed value "${element.fixedId}", got "${value}"`,
        location: element.path,
      }];
    }
    return [];
  }

  return [];
}

function countValue(v: unknown): number {
  if (v === undefined || v === null) return 0;
  return Array.isArray(v) ? v.length : 1;
}

function parseMax(max: string | undefined): number | undefined {
  if (max === undefined || max === "*") return undefined;
  const n = parseInt(max, 10);
  return isNaN(n) ? undefined : n;
}

export function checkComplexType(
  value: unknown,
  element: StructureDefinitionElement,
  locationPrefix: string,
  childElements?: StructureDefinitionElement[]
): ValidationIssue[] {
  if (value === null || value === undefined) return [];

  const issues: ValidationIssue[] = [];

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const itemLocation = `${locationPrefix}[${i}]`;
        issues.push(...validateObject(item as Record<string, unknown>, element, itemLocation, childElements));
      }
    }
    return issues;
  }

  if (typeof value === "object") {
    return validateObject(value as Record<string, unknown>, element, locationPrefix, childElements);
  }

  return issues;
}

function validateObject(
  obj: Record<string, unknown>,
  element: StructureDefinitionElement,
  locationPrefix: string,
  childElements?: StructureDefinitionElement[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (element.min !== undefined && element.min > 0 && Object.keys(obj).length === 0) {
    issues.push({
      severity: "error",
      code: "cardinality",
      diagnostics: `Complex type at ${element.path} is empty but requires at least ${element.min} element(s)`,
      location: locationPrefix,
    });
  }

  if (!childElements) return issues;

  for (const child of childElements) {
    const childPathParts = child.path.split(".");
    if (childPathParts.length < 3) continue;

    const directChildName = childPathParts[childPathParts.length - 1]!;
    const parentPathOfChild = childPathParts.slice(1, -1);

    const isDirectChild = parentPathOfChild.length === 1 &&
      parentPathOfChild[0] === element.path.split(".").pop();

    if (!isDirectChild) continue;

    const value = obj[directChildName];
    const count = countValue(value);
    const childMin = child.min ?? 0;
    const childMaxCount = parseMax(child.max);

    const childLocation = `${locationPrefix}.${directChildName}`;

    if (childMin > 0 && count < childMin) {
      issues.push({
        severity: "error",
        code: "cardinality",
        diagnostics: `Expected at least ${childMin} occurrence(s) of ${child.path}, found ${count}`,
        location: childLocation,
      });
    }

    if (childMaxCount !== undefined && count > childMaxCount) {
      issues.push({
        severity: "error",
        code: "cardinality",
        diagnostics: `Expected at most ${childMaxCount} occurrence(s) of ${child.path}, found ${count}`,
        location: childLocation,
      });
    }
  }

  return issues;
}
