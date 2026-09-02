import type { StructureDefinitionElement, ValidationIssue } from "../types.ts";

function parseMax(max: string | undefined): number | undefined {
  if (max === undefined || max === "*") return undefined;
  const n = parseInt(max, 10);
  return isNaN(n) ? undefined : n;
}

function countValue(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return Array.isArray(value) ? value.length : 1;
}

interface ResolvedNode {
  node: unknown;
  pathWithIndices: string[];
}

function resolvePathWithIndices(
  obj: Record<string, unknown>,
  pathParts: string[],
  startIdx: number = 0,
  currentPath: string[] = []
): ResolvedNode[] {
  if (startIdx >= pathParts.length) {
    return [{ node: obj, pathWithIndices: currentPath }];
  }

  const key = pathParts[startIdx]!;
  const current = obj[key];

  if (current === undefined || current === null) return [];

  if (Array.isArray(current)) {
    const results: ResolvedNode[] = [];
    for (let i = 0; i < current.length; i++) {
      const item = current[i];
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const itemPath = [...currentPath, `${key}[${i}]`];
        const sub = resolvePathWithIndices(item as Record<string, unknown>, pathParts, startIdx + 1, itemPath);
        results.push(...sub);
      }
    }
    return results;
  }

  if (typeof current === "object") {
    return resolvePathWithIndices(current as Record<string, unknown>, pathParts, startIdx + 1, [...currentPath, key]);
  }

  return [];
}

function formatLocation(resourceType: string, pathWithIndices: string[], leafName: string): string {
  const parts = [resourceType];
  for (const segment of pathWithIndices) {
    parts.push(`.${segment}`);
  }
  if (leafName) {
    parts.push(`.${leafName}`);
  }
  return parts.join("");
}

export function checkCardinality(
  resource: Record<string, unknown>,
  element: StructureDefinitionElement,
  resourceType: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pathParts = element.path.split(".");

  if (pathParts.length <= 1) return issues;

  const relativePath = pathParts.slice(1);
  const min = element.min ?? 0;
  const maxCount = parseMax(element.max);
  const hasMinConstraint = min > 0;
  const hasMaxConstraint = maxCount !== undefined;

  if (!hasMinConstraint && !hasMaxConstraint) return issues;

  if (relativePath.length === 1) {
    const leafName = relativePath[0]!;
    const count = countValue(resource[leafName]);
    const location = `${resourceType}.${leafName}`;

    if (hasMinConstraint && count < min) {
      issues.push({
        severity: "error",
        code: "cardinality",
        diagnostics: `Expected at least ${min} occurrence(s) of ${element.path}, found ${count}`,
        location,
      });
    }

    if (hasMaxConstraint && count > maxCount) {
      issues.push({
        severity: "error",
        code: "cardinality",
        diagnostics: `Expected at most ${maxCount} occurrence(s) of ${element.path}, found ${count}`,
        location,
      });
    }

    return issues;
  }

  const parentPathParts = relativePath.slice(0, -1);
  const leafName = relativePath[relativePath.length - 1]!;

  const resolved = resolvePathWithIndices(resource, parentPathParts);

  const seenLocations = new Set<string>();

  for (const { node: parentValue, pathWithIndices } of resolved) {
    if (typeof parentValue !== "object" || parentValue === null) continue;
    if (Array.isArray(parentValue)) continue;

    const parentObj = parentValue as Record<string, unknown>;
    const leafValue = parentObj[leafName];
    const count = countValue(leafValue);

    const location = formatLocation(resourceType, pathWithIndices, leafName);

    if (seenLocations.has(location)) continue;
    seenLocations.add(location);

    if (hasMinConstraint && count < min) {
      issues.push({
        severity: "error",
        code: "cardinality",
        diagnostics: `Expected at least ${min} occurrence(s) of ${element.path}, found ${count}`,
        location,
      });
    }

    if (hasMaxConstraint && count > maxCount) {
      issues.push({
        severity: "error",
        code: "cardinality",
        diagnostics: `Expected at most ${maxCount} occurrence(s) of ${element.path}, found ${count}`,
        location,
      });
    }
  }

  return issues;
}
