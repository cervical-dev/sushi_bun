import type { ValidationIssue } from "../types.ts";

const MAX_EXTENSION_DEPTH = 10;

function isAbsoluteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "urn:";
  } catch {
    return false;
  }
}

export function validateExtensions(
  resource: Record<string, unknown>,
  resourceType: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const extensions = resource.extension;

  if (!Array.isArray(extensions)) return issues;

  validateExtensionArray(extensions, resourceType, 0, issues, "");

  return issues;
}

function validateExtensionArray(
  extensions: unknown[],
  resourceType: string,
  depth: number,
  issues: ValidationIssue[],
  locationPrefix: string
): void {
  if (depth > MAX_EXTENSION_DEPTH) {
    issues.push({
      severity: "error",
      code: "extension-depth-exceeded",
      diagnostics: `Extension nesting exceeds maximum depth of ${MAX_EXTENSION_DEPTH}`,
      location: locationPrefix || resourceType,
    });
    return;
  }

  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i];
    const extLocation = locationPrefix ? `${locationPrefix}.extension[${i}]` : `${resourceType}.extension[${i}]`;

    if (typeof ext !== "object" || ext === null || Array.isArray(ext)) continue;

    const extObj = ext as Record<string, unknown>;

    if (!extObj.url) {
      issues.push({
        severity: "error",
        code: "missing-extension-url",
        diagnostics: `Extension at ${extLocation} is missing required "url" element`,
        location: extLocation,
      });
      continue;
    }

    if (typeof extObj.url !== "string") {
      issues.push({
        severity: "error",
        code: "invalid-extension-url",
        diagnostics: `Extension url must be a string, got ${typeof extObj.url}`,
        location: extLocation,
      });
      continue;
    }

    if (!isAbsoluteUrl(extObj.url)) {
      issues.push({
        severity: "error",
        code: "invalid-extension-url",
        diagnostics: `Extension url must be an absolute URL, got "${extObj.url}"`,
        location: extLocation,
      });
    }

    const nestedExtensions = extObj.extension;
    if (Array.isArray(nestedExtensions)) {
      validateExtensionArray(nestedExtensions, resourceType, depth + 1, issues, extLocation);
    }
  }
}
