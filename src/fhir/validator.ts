import type { StructureDefinition, StructureDefinitionElement, ValidationResult, ValidationIssue } from "./types.ts";
import { validatePrimitive } from "./type-checker/primitive-checker.ts";
import { checkCardinality } from "./type-checker/cardinality-checker.ts";
import { checkChoiceType } from "./type-checker/choice-type-checker.ts";
import { checkFixedValue, checkComplexType } from "./type-checker/complex-type-checker.ts";
import { validateExtensions } from "./extension/extension-validator.ts";
import { parse } from "./fhirpath/parser.ts";
import { evaluate } from "./fhirpath/evaluator.ts";

const MAX_DEPTH = 64;

export interface ValidationOptions {
  checkPrimitives?: boolean;
  checkFixedValues?: boolean;
  checkChoiceTypes?: boolean;
  evaluateConstraints?: boolean;
  checkExtensions?: boolean;
}

const DEFAULT_OPTIONS: ValidationOptions = {
  checkPrimitives: true,
  checkFixedValues: true,
  checkChoiceTypes: true,
  evaluateConstraints: true,
  checkExtensions: true,
};

export function validateResource(
  resource: Record<string, unknown>,
  sd: StructureDefinition,
  options: ValidationOptions = DEFAULT_OPTIONS
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!resource.resourceType || resource.resourceType !== sd.type) {
    issues.push({
      severity: "error",
      code: "invalid-resource-type",
      diagnostics: `Expected resourceType "${sd.type}", got "${resource.resourceType ?? "missing"}"`,
      location: "Resource",
    });
    return { valid: false, issues };
  }

  if (!sd.differential?.element) {
    return { valid: true, issues: [] };
  }

  const elements = sd.differential.element;

  if (options.checkChoiceTypes) {
    const choiceIssues = checkChoiceType(resource, elements, sd.type);
    issues.push(...choiceIssues);
  }

  const elementIndex = new Map<string, StructureDefinitionElement[]>();
  for (const el of elements) {
    const pathParts = el.path.split(".");
    if (pathParts.length < 2) continue;
    const directParent = pathParts.slice(1, -1).join(".");
    const existing = elementIndex.get(directParent) ?? [];
    existing.push(el);
    elementIndex.set(directParent, existing);
  }

  for (const element of elements) {
    if (element.sliceName) continue;
    validateElementPipeline(resource, element, sd.type, issues, options, 0, elementIndex);
  }

  for (const element of elements) {
    if (element.sliceName) continue;
    validateMustSupport(resource, element, sd.type, issues);
  }

  if (options.evaluateConstraints) {
    for (const element of elements) {
      if (element.sliceName) continue;
      validateFhirPathConstraints(resource, element, sd.type, issues);
    }
  }

  if (options.checkExtensions) {
    const extIssues = validateExtensions(resource, sd.type);
    issues.push(...extIssues);
  }

  return { valid: issues.length === 0, issues };
}

function validateMustSupport(
  resource: Record<string, unknown>,
  element: StructureDefinitionElement,
  resourceType: string,
  issues: ValidationIssue[]
): void {
  if (!element.mustSupport) return;
  if (element.min === undefined || element.min <= 0) return;

  const pathParts = element.path.split(".");
  const relativePath = pathParts.slice(1);
  if (relativePath.length === 0) return;

  if (relativePath.length === 1) {
    const leafName = relativePath[0]!;
    const value = resource[leafName];
    const count = value === undefined || value === null ? 0 : (Array.isArray(value) ? value.length : 1);

    if (count === 0) {
      issues.push({
        severity: "error",
        code: "must-support",
        diagnostics: `Required element ${element.path} is missing`,
        location: `${resourceType}.${leafName}`,
      });
    }
    return;
  }

  const parentPath = relativePath.slice(0, -1);
  const leafName = relativePath[relativePath.length - 1]!;
  const resolved = resolvePathNodes(resource, parentPath);

  for (const { node, pathWithIndices } of resolved) {
    if (typeof node !== "object" || node === null) continue;

    const nodeObj = node as Record<string, unknown>;
    const leafValue = nodeObj[leafName];
    const count = leafValue === undefined || leafValue === null ? 0 : (Array.isArray(leafValue) ? leafValue.length : 1);

    if (count === 0) {
      const location = formatLocation(resourceType, pathWithIndices, leafName);
      issues.push({
        severity: "error",
        code: "must-support",
        diagnostics: `Required element ${element.path} is missing`,
        location,
      });
    }
  }
}

const fhirPathCache = new Map<string, ReturnType<typeof parse>>();

function validateFhirPathConstraints(
  resource: Record<string, unknown>,
  element: StructureDefinitionElement,
  resourceType: string,
  issues: ValidationIssue[]
): void {
  if (!element.constraint || element.constraint.length === 0) return;

  const pathParts = element.path.split(".");
  const relativePath = pathParts.slice(1);
  if (relativePath.length === 0) return;

  for (const constraint of element.constraint) {
    if (!constraint.expression) continue;

    let ast = fhirPathCache.get(constraint.expression);
    if (!ast) {
      try {
        ast = parse(constraint.expression);
        fhirPathCache.set(constraint.expression, ast);
      } catch {
        issues.push({
          severity: "warning",
          code: "invalid-fhirpath",
          diagnostics: `Failed to parse FHIRPath expression: ${constraint.expression}`,
          location: `${resourceType}.${relativePath.join(".")}`,
        });
        continue;
      }
    }

    const resolved = relativePath.length === 1
      ? [{ node: resource, pathWithIndices: [] }]
      : resolvePathNodes(resource, relativePath.slice(0, -1));

    for (const { node, pathWithIndices } of resolved) {
      if (typeof node !== "object" || node === null) continue;

      try {
        const result = evaluate(ast, node as Record<string, unknown>);
        if (result === false || result === undefined || result === null) {
          const severity = constraint.severity === "error" ? "error" : "warning";
          const location = relativePath.length === 1
            ? `${resourceType}.${relativePath[0]}`
            : formatLocation(resourceType, pathWithIndices, relativePath[relativePath.length - 1]!);
          issues.push({
            severity,
            code: "invariant",
            diagnostics: constraint.human ?? constraint.expression,
            location,
          });
        }
      } catch {
        issues.push({
          severity: "warning",
          code: "fhirpath-evaluation-error",
          diagnostics: `Failed to evaluate FHIRPath: ${constraint.expression}`,
          location: `${resourceType}.${relativePath.join(".")}`,
        });
      }
    }
  }
}

function validateElementPipeline(
  resource: Record<string, unknown>,
  element: StructureDefinitionElement,
  resourceType: string,
  issues: ValidationIssue[],
  options: ValidationOptions,
  depth: number,
  elementIndex: Map<string, StructureDefinitionElement[]>
): void {
  if (depth > MAX_DEPTH) return;

  const pathParts = element.path.split(".");
  const relativePath = pathParts.slice(1);

  if (relativePath.length === 0) return;

  const cardinalityIssues = checkCardinality(resource, element, resourceType);
  issues.push(...cardinalityIssues);

  if (relativePath.length === 1) {
    const leafName = relativePath[0]!;
    const value = resource[leafName];

    if (options.checkPrimitives && element.type && value !== undefined && value !== null) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (v === undefined || v === null) continue;
        const primitiveIssues = validatePrimitive(v, element);
        issues.push(...primitiveIssues);
      }
    }

    if (options.checkFixedValues && value !== undefined && value !== null) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (v === undefined || v === null) continue;
        const fixedIssues = checkFixedValue(v, element);
        issues.push(...fixedIssues);
      }
    }

    if (element.constraint) {
      // FHIRPath constraints will be evaluated in Phase 4
    }

    return;
  }

  const parentPath = relativePath.slice(0, -1);
  const leafName = relativePath[relativePath.length - 1]!;
  const resolved = resolvePathNodes(resource, parentPath);

  for (const { node, pathWithIndices } of resolved) {
    if (typeof node !== "object" || node === null) continue;

    const nodeObj = node as Record<string, unknown>;
    const leafValue = nodeObj[leafName];

    if (options.checkPrimitives && element.type && leafValue !== undefined && leafValue !== null) {
      const values = Array.isArray(leafValue) ? leafValue : [leafValue];
      for (let vi = 0; vi < values.length; vi++) {
        const v = values[vi];
        if (v === undefined || v === null) continue;
        const itemSuffix = Array.isArray(leafValue) ? `[${vi}]` : "";
        const location = formatLocation(resourceType, pathWithIndices, `${leafName}${itemSuffix}`);
        const primitiveElement = { ...element, path: location };
        const primitiveIssues = validatePrimitive(v, primitiveElement);
        issues.push(...primitiveIssues);
      }
    }

    if (options.checkFixedValues && leafValue !== undefined && leafValue !== null) {
      const values = Array.isArray(leafValue) ? leafValue : [leafValue];
      for (let vi = 0; vi < values.length; vi++) {
        const v = values[vi];
        if (v === undefined || v === null) continue;
        const itemSuffix = Array.isArray(leafValue) ? `[${vi}]` : "";
        const location = formatLocation(resourceType, pathWithIndices, `${leafName}${itemSuffix}`);
        const fixedElement = { ...element, path: location };
        const fixedIssues = checkFixedValue(v, fixedElement);
        issues.push(...fixedIssues);
      }
    }

    if (Array.isArray(leafValue) && element.type) {
      const elementTypeName = element.type[0]?.code;
      if (elementTypeName === "BackboneElement" || elementTypeName === "ComplexType") {
        const childKey = relativePath.join(".");
        const childElements = elementIndex.get(childKey);
        if (childElements && childElements.length > 0) {
          const location = formatLocation(resourceType, pathWithIndices, leafName);
          for (let i = 0; i < leafValue.length; i++) {
            const item = leafValue[i];
            if (typeof item === "object" && item !== null && !Array.isArray(item)) {
              const itemLocation = `${location}[${i}]`;
              const complexIssues = checkComplexType(item, element, itemLocation, childElements);
              issues.push(...complexIssues);

              for (const childEl of childElements) {
                validateElementPipeline(
                  item as Record<string, unknown>,
                  childEl,
                  resourceType,
                  issues,
                  options,
                  depth + 1,
                  elementIndex
                );
              }
            }
          }
        }
      }
    }
  }
}

interface ResolvedNode {
  node: unknown;
  pathWithIndices: string[];
}

function resolvePathNodes(
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
        const sub = resolvePathNodes(item as Record<string, unknown>, pathParts, startIdx + 1, itemPath);
        results.push(...sub);
      }
    }
    return results;
  }

  if (typeof current === "object") {
    return resolvePathNodes(current as Record<string, unknown>, pathParts, startIdx + 1, [...currentPath, key]);
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
