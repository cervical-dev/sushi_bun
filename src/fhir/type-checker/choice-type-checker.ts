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

export function checkChoiceType(
  resource: Record<string, unknown>,
  elements: StructureDefinitionElement[],
  resourceType: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const choiceElements = elements.filter(isChoiceElement);

  for (const element of choiceElements) {
    const prefix = extractChoicePrefix(element);
    const allowedTypes = new Set(
      (element.type ?? []).map(t => toChoiceVariantName(prefix, t.code))
    );

    const presentVariants: string[] = [];
    for (const key of Object.keys(resource)) {
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

  return issues;
}
