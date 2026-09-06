import type { StructureDefinitionElement, ValidationIssue } from "../types.ts";
import { parseMax } from "../element-path.ts";

interface SliceInfo {
  sliceName: string;
  min: number;
  max: number | undefined;
  discriminatorPath?: string;
}

function matchesDiscriminator(
  item: Record<string, unknown>,
  discriminatorPath: string
): unknown {
  const parts = discriminatorPath.split(".");
  let current: unknown = item;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (current === null || current === undefined || typeof current !== "object") return undefined;

    if (Array.isArray(current)) {
      const results: unknown[] = [];
      for (const arrItem of current) {
        if (arrItem !== null && typeof arrItem === "object" && !Array.isArray(arrItem)) {
          const remaining = parts.slice(i).join(".");
          const val = matchesDiscriminator(arrItem as Record<string, unknown>, remaining);
          if (val !== undefined) results.push(val);
        }
      }
      return results.length === 1 ? results[0] : results.length > 0 ? results : undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveSliceInfo(elements: StructureDefinitionElement[]): {
  slicingElement: StructureDefinitionElement | undefined;
  slices: SliceInfo[];
} {
  let slicingElement: StructureDefinitionElement | undefined;
  const slices: SliceInfo[] = [];

  for (const el of elements) {
    if (el.slicing) {
      slicingElement = el;
    }
    if (el.sliceName) {
      slices.push({
        sliceName: el.sliceName,
        min: el.min ?? 0,
        max: parseMax(el.max),
        discriminatorPath: el.slicing?.discriminator[0]?.path,
      });
    }
  }

  return { slicingElement, slices };
}

function identifySlice(
  item: Record<string, unknown>,
  slices: SliceInfo[],
  discriminatorPath?: string
): string | undefined {
  if (!discriminatorPath) return undefined;

  const value = matchesDiscriminator(item, discriminatorPath);
  if (value === undefined) return undefined;

  const valueStr = typeof value === "object"
    ? JSON.stringify(value)
    : String(value);

  for (const slice of slices) {
    const sliceBaseName = slice.sliceName.includes(":")
      ? slice.sliceName.split(":").pop()!
      : slice.sliceName;

    if (valueStr === sliceBaseName) {
      return slice.sliceName;
    }

    if (typeof value === "string" && value === sliceBaseName) {
      return slice.sliceName;
    }

    if (typeof value === "object" && value !== null) {
      const coded = value as Record<string, unknown>;
      if (typeof coded.code === "string" && coded.code === sliceBaseName) {
        return slice.sliceName;
      }
      if (Array.isArray(coded.coding)) {
        for (const c of coded.coding) {
          if (typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).code === "string") {
            if ((c as Record<string, unknown>).code === sliceBaseName) {
              return slice.sliceName;
            }
          }
        }
      }
    }
  }

  return undefined;
}

export function validateSlicing(
  resource: Record<string, unknown>,
  elementPath: string,
  elements: StructureDefinitionElement[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { slicingElement, slices } = resolveSliceInfo(elements);

  if (!slicingElement || slices.length === 0) return issues;

  const pathParts = elementPath.split(".");
  const leafName = pathParts[pathParts.length - 1]!;
  const parentPath = pathParts.slice(1, -1);

  let arrayValue: unknown;
  if (parentPath.length === 0) {
    arrayValue = resource[leafName];
  } else {
    let current: unknown = resource;
    for (const part of parentPath) {
      if (current === null || current === undefined || typeof current !== "object") {
        return issues;
      }
      if (Array.isArray(current)) {
        current = current[0];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }
    if (current !== null && typeof current === "object" && !Array.isArray(current)) {
      arrayValue = (current as Record<string, unknown>)[leafName];
    }
  }

  if (!Array.isArray(arrayValue) || arrayValue.length === 0) return issues;

  const discriminatorPath = slicingElement.slicing?.discriminator[0]?.path;
  const rules = slicingElement.slicing?.rules ?? "open";
  const sliceCounts = new Map<string, number>();

  for (const item of arrayValue) {
    if (typeof item !== "object" || item === null) continue;

    const sliceName = identifySlice(item as Record<string, unknown>, slices, discriminatorPath);

    if (sliceName) {
      sliceCounts.set(sliceName, (sliceCounts.get(sliceName) ?? 0) + 1);
    } else if (rules === "closed" || rules === "openAtEnd") {
      issues.push({
        severity: "error",
        code: "unrecognized-slice",
        diagnostics: `Unrecognized slice in ${elementPath} (closed slicing)`,
        location: elementPath,
      });
    }
  }

  for (const slice of slices) {
    const count = sliceCounts.get(slice.sliceName) ?? 0;

    if (slice.min > 0 && count < slice.min) {
      issues.push({
        severity: "error",
        code: "missing-slice",
        diagnostics: `Required slice "${slice.sliceName}" is missing from ${elementPath} (need at least ${slice.min})`,
        location: elementPath,
      });
    }

    if (slice.max !== undefined && count > slice.max) {
      issues.push({
        severity: "error",
        code: "too-many-slices",
        diagnostics: `Slice "${slice.sliceName}" in ${elementPath} has ${count} items, max is ${slice.max}`,
        location: elementPath,
      });
    }
  }

  return issues;
}
