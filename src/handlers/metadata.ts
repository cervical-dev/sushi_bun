import type { OperationOutcome } from "../fhir/types.ts";

export function handleMetadata(_req: Request, capabilityJson: Record<string, unknown>): Response {
  return Response.json(capabilityJson, {
    status: 200,
    headers: {
      "Content-Type": "application/fhir+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function createOperationOutcome(
  severity: "fatal" | "error" | "warning" | "information",
  code: string,
  diagnostics: string,
  status: number = 400
): Response {
  const outcome: OperationOutcome = {
    resourceType: "OperationOutcome",
    issue: [
      {
        severity,
        code,
        diagnostics,
      },
    ],
  };
  return Response.json(outcome, { status });
}
