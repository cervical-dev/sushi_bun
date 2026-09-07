import type { OperationOutcome, ValidationIssue } from "../fhir/types.ts";

export function buildOperationOutcome(
  severity: "fatal" | "error" | "warning" | "information",
  code: string,
  diagnostics: string
): OperationOutcome {
  return {
    resourceType: "OperationOutcome",
    issue: [
      {
        severity,
        code,
        diagnostics,
      },
    ],
  };
}

export function createOperationOutcome(
  severity: "fatal" | "error" | "warning" | "information",
  code: string,
  diagnostics: string,
  status: number = 400,
  etag?: string
): Response {
  const outcome = buildOperationOutcome(severity, code, diagnostics);
  const headers: Record<string, string> = { "Content-Type": "application/fhir+json" };
  if (etag) {
    headers.ETag = etag;
  }
  return Response.json(outcome, { status, headers });
}

export function createOperationOutcomeFromIssues(
  issues: ValidationIssue[],
  status: number = 422
): Response {
  const outcome: OperationOutcome = {
    resourceType: "OperationOutcome",
    issue: issues.map((i) => ({
      severity: i.severity,
      code: i.code,
      diagnostics: i.diagnostics,
      location: i.location ? [i.location] : undefined,
    })),
  };
  return Response.json(outcome, { status, headers: { "Content-Type": "application/fhir+json" } });
}
