import type { ElementBinding, ValidationIssue } from "../types.ts";

export function checkBinding(
  code: unknown,
  system: string | undefined,
  binding: ElementBinding | undefined,
  codeSystems: Map<string, Set<string>>
): ValidationIssue[] {
  if (binding === undefined) return [];
  if (code === null || code === undefined) return [];

  if (binding.strength === "example") return [];

  const codeStr = String(code);

  if (!system) {
    if (binding.strength === "required") {
      return [{
        severity: "error",
        code: "missing-code-system",
        diagnostics: `Code "${codeStr}" must have a system when binding is required`,
      }];
    }
    return [];
  }

  const allowedCodes = codeSystems.get(system);

  if (allowedCodes && !allowedCodes.has(codeStr)) {
    const severity = binding.strength === "required" ? "error"
      : binding.strength === "extensible" ? "warning"
      : "information";

    return [{
      severity,
      code: "code-not-in-value-set",
      diagnostics: `Code "${codeStr}" from system "${system}" is not in the bound ValueSet`,
    }];
  }

  if (!allowedCodes) {
    if (binding.strength === "required") {
      return [{
        severity: "error",
        code: "invalid-code",
        diagnostics: `Code "${codeStr}" from system "${system}" is not in any registered CodeSystem (binding is required)`,
      }];
    }
    const severity = binding.strength === "extensible" ? "warning" : "information";
    return [{
      severity,
      code: "code-not-in-value-set",
      diagnostics: `Code "${codeStr}" from system "${system}" is not in a registered CodeSystem`,
    }];
  }

  return [];
}
