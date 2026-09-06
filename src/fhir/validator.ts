import type { StructureDefinition, StructureDefinitionElement, ValidationResult, ValidationIssue } from "./types.ts";
import { validatePrimitive } from "./type-checker/primitive-checker.ts";
import { checkCardinality } from "./type-checker/cardinality-checker.ts";
import { checkChoiceType } from "./type-checker/choice-type-checker.ts";
import { checkFixedValue, checkComplexType } from "./type-checker/complex-type-checker.ts";
import { validateExtensions } from "./extension/extension-validator.ts";
import { validateBundle } from "./bundle-validator.ts";
import { validateSlicing } from "./slicing/slice-validator.ts";
import { checkBinding } from "./terminology/binding-checker.ts";
import { parse } from "./fhirpath/parser.ts";
import { evaluate } from "./fhirpath/evaluator.ts";
import { resolvePathNodes, formatLocation } from "./element-path.ts";

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

  const elements = sd.differential?.element ?? sd.snapshot?.element;

  if (!elements) {
    return { valid: true, issues: [] };
  }

  if (options.checkChoiceTypes) {
    const choiceIssues = checkChoiceType(resource, elements, sd.type);
    issues.push(...choiceIssues);
  }

  if (resource.resourceType === "Bundle") {
    const bundleIssues = validateBundle(resource, sd);
    issues.push(...bundleIssues);
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

  const codeSystems = new Map<string, Set<string>>();
  for (const element of elements) {
    if (element.sliceName) continue;
    if (!element.binding) continue;
    validateBinding(resource, element, sd.type, issues, codeSystems);
  }

  for (const element of elements) {
    if (element.sliceName) continue;
    if (!element.slicing) continue;
    const sliceIssues = validateSlicing(resource, element.path, elements);
    issues.push(...sliceIssues);
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

function validateBinding(
  resource: Record<string, unknown>,
  element: StructureDefinitionElement,
  resourceType: string,
  issues: ValidationIssue[],
  codeSystems: Map<string, Set<string>>
): void {
  if (!element.binding) return;

  const pathParts = element.path.split(".");
  const relativePath = pathParts.slice(1);
  if (relativePath.length === 0) return;

  const leafName = relativePath[relativePath.length - 1]!;

  const resolved = relativePath.length === 1
    ? [{ node: resource, pathWithIndices: [] }]
    : resolvePathNodes(resource, relativePath.slice(0, -1));

  for (const { node, pathWithIndices } of resolved) {
    if (typeof node !== "object" || node === null) continue;

    const nodeObj = node as Record<string, unknown>;
    const leafValue = nodeObj[leafName];

    if (leafValue === undefined || leafValue === null) continue;

    const values = Array.isArray(leafValue) ? leafValue : [leafValue];
    for (const v of values) {
      if (v === undefined || v === null) continue;

      let code: unknown;
      let system: string | undefined;

      if (typeof v === "string") {
        code = v;
      } else if (typeof v === "object" && v !== null) {
        const vObj = v as Record<string, unknown>;
        if (typeof vObj.code === "string") {
          code = vObj.code;
          system = typeof vObj.system === "string" ? vObj.system : undefined;
        } else if (Array.isArray(vObj.coding) && vObj.coding.length > 0) {
          const firstCoding = vObj.coding[0] as Record<string, unknown>;
          if (typeof firstCoding.code === "string") {
            code = firstCoding.code;
            system = typeof firstCoding.system === "string" ? firstCoding.system : undefined;
          }
        }
      }

      if (code !== undefined) {
        const location = relativePath.length === 1
          ? `${resourceType}.${leafName}`
          : formatLocation(resourceType, pathWithIndices, leafName);
        const bindingIssues = checkBinding(code, system, element.binding, codeSystems);
        for (const issue of bindingIssues) {
          issues.push({ ...issue, location });
        }
      }
    }
  }
}

const MAX_FHIRPATH_CACHE = 1000;
const fhirPathCache = new Map<string, ReturnType<typeof parse>>();

function cacheFhirPath(expression: string, ast: ReturnType<typeof parse>): void {
  if (fhirPathCache.size >= MAX_FHIRPATH_CACHE) {
    const firstKey = fhirPathCache.keys().next().value;
    if (firstKey !== undefined) fhirPathCache.delete(firstKey);
  }
  fhirPathCache.set(expression, ast);
}

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
        cacheFhirPath(constraint.expression, ast);
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

    const leafName = relativePath[relativePath.length - 1]!;

    const resolved = relativePath.length === 1
      ? [{ node: resource, pathWithIndices: [] }]
      : resolvePathNodes(resource, relativePath.slice(0, -1));

    for (const { node, pathWithIndices } of resolved) {
      if (typeof node !== "object" || node === null) continue;

      let evalContext: unknown;
      if (relativePath.length === 1) {
        evalContext = node;
      } else {
        const nodeObj = node as Record<string, unknown>;
        evalContext = nodeObj[leafName];
        if (evalContext === undefined || evalContext === null) continue;
      }

      try {
        const result = evaluate(ast, evalContext as Record<string, unknown>);
        if (result === false || result === undefined || result === null) {
          const severity = constraint.severity === "error" ? "error" : "warning";
          const location = relativePath.length === 1
            ? `${resourceType}.${relativePath[0]}`
            : formatLocation(resourceType, pathWithIndices, leafName);
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

    if (Array.isArray(value) && element.type) {
      const elementTypeName = element.type[0]?.code;
      if (elementTypeName === "BackboneElement" || elementTypeName === "ComplexType") {
        const childKey = element.path.split(".").slice(1).join(".");
        const childElements = elementIndex.get(childKey);
        if (childElements && childElements.length > 0) {
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (typeof item === "object" && item !== null && !Array.isArray(item)) {
              const itemLocation = `${resourceType}.${leafName}[${i}]`;
              const complexIssues = checkComplexType(item, element, itemLocation, childElements);
              issues.push(...complexIssues);
            }
          }
        }
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value) && element.type) {
      const elementTypeName = element.type[0]?.code;
      if (elementTypeName === "BackboneElement" || elementTypeName === "ComplexType") {
        const childKey = element.path.split(".").slice(1).join(".");
        const childElements = elementIndex.get(childKey);
        if (childElements && childElements.length > 0) {
          const location = `${resourceType}.${leafName}`;
          const complexIssues = checkComplexType(value, element, location, childElements);
          issues.push(...complexIssues);
        }
      }
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
            }
          }
        }
      }
    } else if (typeof leafValue === "object" && leafValue !== null && !Array.isArray(leafValue) && element.type) {
      const elementTypeName = element.type[0]?.code;
      if (elementTypeName === "BackboneElement" || elementTypeName === "ComplexType") {
        const childKey = relativePath.join(".");
        const childElements = elementIndex.get(childKey);
        if (childElements && childElements.length > 0) {
          const location = formatLocation(resourceType, pathWithIndices, leafName);
          const complexIssues = checkComplexType(leafValue, element, location, childElements);
          issues.push(...complexIssues);
        }
      }
    }
  }
}
