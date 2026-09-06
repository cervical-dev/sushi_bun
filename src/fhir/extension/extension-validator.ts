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

  if (Array.isArray(extensions)) {
    validateExtensionArray(extensions, resourceType, 0, issues, "");
  }

  walkAndValidateExtensions(resource, resourceType, issues, [resourceType]);

  return issues;
}

function walkAndValidateExtensions(
  node: Record<string, unknown>,
  resourceType: string,
  issues: ValidationIssue[],
  pathParts: string[]
): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === "extension" || key === "url" || key === "resourceType") continue;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const itemObj = item as Record<string, unknown>;
          const itemLocation = `${pathParts.join(".")}.${key}[${i}]`;

          if (Array.isArray(itemObj.extension)) {
            validateExtensionArray(itemObj.extension, resourceType, 0, issues, itemLocation);
          }

          walkAndValidateExtensions(itemObj, resourceType, issues, [...pathParts, `${key}[${i}]`]);
        }
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const childObj = value as Record<string, unknown>;
      const childLocation = `${pathParts.join(".")}.${key}`;

      if (Array.isArray(childObj.extension)) {
        validateExtensionArray(childObj.extension, resourceType, 0, issues, childLocation);
      }

      walkAndValidateExtensions(childObj, resourceType, issues, [...pathParts, key]);
    }
  }
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
