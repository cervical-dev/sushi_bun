import type { ResourceConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

export function handleOperation(
  req: Request,
  operationName: string,
  config: ResourceConfig,
  store: ResourceStore
): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resourceType = pathParts[0]!;

  switch (operationName) {
    case "everything":
      return handleEverything(resourceType, store);
    case "validate":
      return handleValidate(resourceType, store);
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
  const resources = store.search(resourceType, []);

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

function handleValidate(_resourceType: string, _store: ResourceStore): Response {
  const outcome = {
    resourceType: "OperationOutcome",
    issue: [
      {
        severity: "information",
        code: "informational",
        diagnostics: "Validation passed (stub implementation)",
      },
    ],
  };

  return Response.json(outcome, {
    status: 200,
    headers: { "Content-Type": "application/fhir+json" },
  });
}
