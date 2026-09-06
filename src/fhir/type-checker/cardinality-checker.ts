import type { StructureDefinitionElement, ValidationIssue } from "../types.ts";
import { parseMax, countValue, resolvePathNodes, formatLocation } from "../element-path.ts";

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

  const resolved = resolvePathNodes(resource, parentPathParts);

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
