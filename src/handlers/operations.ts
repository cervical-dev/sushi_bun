import type { ResourceConfig } from "../fhir/types.ts";
import { getProfileUrl } from "../fhir/types.ts";
import type { ResourceStore, SqlFilter } from "../store/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { validateResource } from "../fhir/validator.ts";
import { createOperationOutcome } from "./metadata.ts";

export function handleOperation(
  req: Request,
  operationName: string,
  config: ResourceConfig,
  store: ResourceStore,
  validators?: ValidatorRegistry
): Response | Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;

  switch (operationName) {
    case "everything":
      return handleEverything(resourceType, store);
    case "validate":
      return handleValidate(req, resourceType, validators);
    default:
      return createOperationOutcome(
        "error",
        "not-found",
        `Operation $${operationName} is not supported for ${resourceType}`,
        404
      );
  }
}

function handleEverything(resourceType: string, store: ResourceStore): Response {
  const resources = store.search(resourceType, [] as SqlFilter[]);

  const bundle = {
    resourceType: "Bundle",
    type: "searchset",
    total: resources.length,
    entry: resources.map((r) => ({
      fullUrl: `${resourceType}/${r.id}`,
      resource: r,
      search: { mode: "match" },
    })),
  };

  return Response.json(bundle, {
    status: 200,
    headers: { "Content-Type": "application/fhir+json" },
  });
}

async function handleValidate(
  req: Request,
  resourceType: string,
  validators?: ValidatorRegistry
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return createOperationOutcome("error", "invalid", "Request body is not valid JSON");
  }

  const resource = body.resourceType === "Parameters" ? extractResourceFromParameters(body) : body;

  if (!resource || typeof resource !== "object") {
    return createOperationOutcome("error", "invalid", "No resource found to validate");
  }

  if (!validators) {
    const outcome = {
      resourceType: "OperationOutcome",
      issue: [
        {
          severity: "information",
          code: "informational",
          diagnostics: "Validation passed (no validators loaded)",
        },
      ],
    };
    return Response.json(outcome, { status: 200, headers: { "Content-Type": "application/fhir+json" } });
  }

  const profileUrl = getProfileUrl(resource);
  const sd = validators.getValidator(resourceType, profileUrl);

  if (!sd) {
    const outcome = {
      resourceType: "OperationOutcome",
      issue: [
        {
          severity: "warning",
          code: "not-found",
          diagnostics: `No StructureDefinition found for ${resourceType}`,
        },
      ],
    };
    return Response.json(outcome, { status: 200, headers: { "Content-Type": "application/fhir+json" } });
  }

  const validation = validateResource(resource, sd);

  const outcome = {
    resourceType: "OperationOutcome",
    issue: validation.issues.length > 0
      ? validation.issues.map((i) => ({
          severity: i.severity,
          code: i.code,
          diagnostics: i.diagnostics,
          location: i.location ? [i.location] : undefined,
        }))
      : [
          {
            severity: "information",
            code: "informational",
            diagnostics: "Validation succeeded",
          },
        ],
  };

  return Response.json(outcome, { status: 200, headers: { "Content-Type": "application/fhir+json" } });
}

function extractResourceFromParameters(params: Record<string, unknown>): Record<string, unknown> | null {
  const parameter = params.parameter;
  if (!Array.isArray(parameter)) return null;

  for (const p of parameter) {
    if (
      typeof p === "object" &&
      p !== null &&
      (p as Record<string, unknown>).name === "resource" &&
      (p as Record<string, unknown>).resource
    ) {
      return (p as Record<string, unknown>).resource as Record<string, unknown>;
    }
  }
  return null;
}
