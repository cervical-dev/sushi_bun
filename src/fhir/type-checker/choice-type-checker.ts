import type { StructureDefinitionElement, ValidationIssue } from "../types.ts";

function isChoiceElement(element: StructureDefinitionElement): boolean {
  return element.path.endsWith("[x]");
}

function extractChoicePrefix(element: StructureDefinitionElement): string {
  const pathParts = element.path.split(".");
  const lastPart = pathParts[pathParts.length - 1]!;
  return lastPart.replace("[x]", "");
}

function toChoiceVariantName(prefix: string, typeCode: string): string {
  const suffix = typeCode.charAt(0).toUpperCase() + typeCode.slice(1);
  return prefix + suffix;
}

function normalizePath(p: string): string {
  return p.replace(/\[\d+\]/g, "");
}

export function checkChoiceType(
  resource: Record<string, unknown>,
  elements: StructureDefinitionElement[],
  resourceType: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const choiceElements = elements.filter(isChoiceElement);

  function checkObject(obj: Record<string, unknown>, currentPath: string): void {
    const normalizedCurrent = normalizePath(currentPath);

    for (const element of choiceElements) {
      const elemPathParts = element.path.split(".");
      const parentPath = elemPathParts.slice(0, -1).join(".");
      if (normalizePath(parentPath) !== normalizedCurrent) continue;

      const choiceName = elemPathParts[elemPathParts.length - 1]!;
      const prefix = choiceName.replace("[x]", "");

      const allowedTypes = new Set(
        (element.type ?? []).map(t => toChoiceVariantName(prefix, t.code))
      );

      const presentVariants: string[] = [];
      for (const key of Object.keys(obj)) {
        if (key.startsWith(prefix) && key !== prefix) {
          const suffix = key.slice(prefix.length);
          if (suffix.length > 0 && suffix[0] === suffix[0]!.toUpperCase()) {
            presentVariants.push(key);
          }
        }
      }

      if (presentVariants.length > 1) {
        issues.push({
          severity: "error",
          code: "multiple-choice-types",
          diagnostics: `Only one of [${presentVariants.join(", ")}] is allowed in ${element.path}`,
          location: `${resourceType}.${prefix}[x]`,
        });
        continue;
      }

      for (const variant of presentVariants) {
        if (!allowedTypes.has(variant)) {
          issues.push({
            severity: "error",
            code: "unknown-choice-type",
            diagnostics: `Unrecognized choice type "${variant}" for ${element.path}. Allowed: [${Array.from(allowedTypes).join(", ")}]`,
            location: `${resourceType}.${variant}`,
          });
        }
      }
    }
  }

  function walkAndCheck(obj: Record<string, unknown>, pathParts: string[]): void {
    checkObject(obj, pathParts.join("."));
    for (const [key, value] of Object.entries(obj)) {
      if (key === "resourceType") continue;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            walkAndCheck(item as Record<string, unknown>, [...pathParts, `${key}[${i}]`]);
          }
        }
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        walkAndCheck(value as Record<string, unknown>, [...pathParts, key]);
      }
    }
  }

  walkAndCheck(resource, [resourceType]);
  return issues;
}
