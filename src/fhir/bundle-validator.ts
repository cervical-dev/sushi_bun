import type { StructureDefinition, StructureDefinitionElement, ValidationIssue } from "./types.ts";

const VALID_BUNDLE_TYPES = new Set([
  "document", "message", "transaction", "transaction-response",
  "batch", "batch-response", "history", "searchset", "collection",
]);

export function validateBundle(
  resource: Record<string, unknown>,
  bundleSD: StructureDefinition
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (resource.resourceType !== "Bundle") return issues;

  const type = resource.type;
  if (type === undefined || type === null) {
    issues.push({
      severity: "error",
      code: "cardinality",
      diagnostics: "Bundle.type is required (min 1..1)",
      location: "Bundle.type",
    });
  } else if (typeof type === "string" && !VALID_BUNDLE_TYPES.has(type)) {
    issues.push({
      severity: "error",
      code: "invalid-value",
      diagnostics: `Invalid Bundle.type "${type}". Valid types: ${Array.from(VALID_BUNDLE_TYPES).join(", ")}`,
      location: "Bundle.type",
    });
  }

  const entries = resource.entry;
  if (!Array.isArray(entries)) return issues;

  const elements = bundleSD.differential?.element ?? [];
  const entryRequestElements = elements.filter(e =>
    e.path.startsWith("Bundle.entry.request.")
  );

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") continue;

    const request = entry.request as Record<string, unknown> | undefined;
    if (request && typeof request === "object") {
      for (const el of entryRequestElements) {
        const pathParts = el.path.split(".");
        const leafName = pathParts[pathParts.length - 1]!;
        const value = request[leafName];
        const count = value === undefined || value === null ? 0 : (Array.isArray(value) ? value.length : 1);

        if (el.min !== undefined && el.min > 0 && count < el.min) {
          issues.push({
            severity: "error",
            code: "cardinality",
            diagnostics: `Expected at least ${el.min} occurrence(s) of ${el.path}, found ${count}`,
            location: `Bundle.entry[${i}].request.${leafName}`,
          });
        }
      }
    }
  }

  return issues;
}
