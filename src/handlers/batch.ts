import type { RouteConfig, Bundle, BundleEntry, FhirResource } from "../fhir/types.ts";
import { getProfileUrl } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { validateResource } from "../fhir/validator.ts";
import { createOperationOutcome } from "./metadata.ts";

interface ValidatableEntry {
  entry: BundleEntry;
  operation: string;
  index: number;
}

interface Slot {
  index: number;
  response?: BundleEntry;
  validatable?: ValidatableEntry;
}

function validateEntry(
  entry: BundleEntry,
  config: RouteConfig,
  tempIdMap: Map<string, string>
): { entry: BundleEntry; error?: string } {
  if (!entry.request) {
    return {
      entry: { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "Entry must have a request" }] } } },
    };
  }

  const { method, url } = entry.request;
  const urlParts = url.split("/").filter(Boolean);
  const resourceType = urlParts[0]!;
  const id = urlParts[1];

  const resourceConfig = config.resources.get(resourceType);
  if (!resourceConfig) {
    return {
      entry: { response: { status: "404", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-found", diagnostics: `Resource type ${resourceType} not supported` }] } } },
    };
  }

  switch (method) {
    case "POST": {
      if (!resourceConfig.interactions.has("create")) {
        return { entry: { response: { status: "405", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: `Create not supported for ${resourceType}` }] } } } };
      }
      if (!entry.resource) {
        return { entry: { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "POST entry must have a resource" }] } } } };
      }
      return { entry, error: "create" };
    }
    case "PUT": {
      if (!id) {
        return { entry: { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "PUT requires an id in the URL" }] } } } };
      }
      if (!resourceConfig.interactions.has("update")) {
        return { entry: { response: { status: "405", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: `Update not supported for ${resourceType}` }] } } } };
      }
      if (!entry.resource) {
        return { entry: { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "PUT entry must have a resource" }] } } } };
      }
      return { entry, error: "update" };
    }
    case "DELETE": {
      if (!resourceConfig.interactions.has("delete")) {
        return { entry: { response: { status: "405", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: `Delete not supported for ${resourceType}` }] } } } };
      }
      const deleteId = id ?? (entry.resource as FhirResource)?.id;
      if (!deleteId) {
        return { entry: { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "DELETE requires an id" }] } } } };
      }
      return { entry, error: "delete" };
    }
    case "GET": {
      if (!id) {
        return { entry: { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "GET in bundle requires an id" }] } } } };
      }
      return { entry, error: "read" };
    }
    default:
      return { entry: { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: `Unsupported method: ${method}` }] } } } };
  }
}

function executeEntry(
  entry: BundleEntry,
  operation: string,
  store: ResourceStore,
  config: RouteConfig,
  tempIdMap: Map<string, string>
): BundleEntry {
  const { method, url } = entry.request!;
  const urlParts = url.split("/").filter(Boolean);
  const resourceType = urlParts[0]!;
  const id = urlParts[1];

  switch (operation) {
    case "create": {
      const resource = entry.resource as FhirResource;
      const created = store.create(resourceType, resource);
      if (entry.fullUrl?.startsWith("urn:uuid:")) {
        tempIdMap.set(entry.fullUrl, `${resourceType}/${created.id}`);
      }
      return {
        fullUrl: `${resourceType}/${created.id}`,
        resource: created,
        response: {
          status: "201",
          location: `${resourceType}/${created.id}/_history/${created.meta?.versionId}`,
          etag: `W/"${created.meta?.versionId}"`,
        },
      };
    }
    case "update": {
      let resolvedId = id!;
      if (id!.startsWith("urn:")) {
        resolvedId = tempIdMap.get(id!)?.split("/").pop() ?? id!;
      }
      const putResource = entry.resource as FhirResource;
      const updated = store.update(resourceType, resolvedId, { ...putResource, id: resolvedId });
      return {
        fullUrl: `${resourceType}/${updated.id}`,
        resource: updated,
        response: {
          status: "200",
          location: `${resourceType}/${updated.id}/_history/${updated.meta?.versionId}`,
          etag: `W/"${updated.meta?.versionId}"`,
        },
      };
    }
    case "delete": {
      const deleteId = id ?? (entry.resource as FhirResource)?.id;
      const deleted = store.softDelete(resourceType, deleteId!);
      return { response: { status: deleted ? "204" : "404" } };
    }
    case "read": {
      const readResource = store.read(resourceType, id!);
      if (readResource) {
        return {
          fullUrl: `${resourceType}/${readResource.id}`,
          resource: readResource,
          response: { status: "200" },
        };
      }
      return { response: { status: "404" } };
    }
    default:
      return { response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: `Unsupported method: ${method}` }] } } };
  }
}

function validateResourceEntry(
  entry: BundleEntry,
  validators: ValidatorRegistry
): BundleEntry | null {
  const resource = entry.resource as Record<string, unknown>;
  if (!resource) return null;

  const resourceType = (resource as FhirResource).resourceType;
  const profileUrl = getProfileUrl(resource);
  const sd = validators.getValidator(resourceType, profileUrl);
  if (!sd) return null;

  const validation = validateResource(resource, sd);
  if (!validation.valid) {
    return {
      response: {
        status: "422",
        outcome: {
          resourceType: "OperationOutcome",
          issue: validation.issues.map((i) => ({
            severity: i.severity,
            code: i.code,
            diagnostics: i.diagnostics,
            location: i.location ? [i.location] : undefined,
          })),
        },
      },
    };
  }
  return null;
}

function makeTransactionError(): BundleEntry {
  return {
    response: {
      status: "422",
      outcome: {
        resourceType: "OperationOutcome",
        issue: [{ severity: "error", code: "transaction-failed", diagnostics: "Transaction aborted due to validation errors" }],
      },
    },
  };
}

export async function handleBatch(
  req: Request,
  config: RouteConfig,
  store: ResourceStore,
  validators?: ValidatorRegistry
): Promise<Response> {
  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/fhir+json") && !contentType.includes("application/json")) {
    return createOperationOutcome("error", "unsupported", "Content-Type must be application/fhir+json", 415);
  }

  let body: Bundle;
  try {
    body = (await req.json()) as Bundle;
  } catch {
    return createOperationOutcome("error", "invalid", "Request body is not valid JSON");
  }

  if (body.resourceType !== "Bundle") {
    return createOperationOutcome("error", "invalid", "Request body must be a Bundle");
  }

  if (body.type !== "transaction" && body.type !== "batch") {
    return createOperationOutcome("error", "invalid", "Bundle type must be 'transaction' or 'batch'");
  }

  if (!body.entry || body.entry.length === 0) {
    return createOperationOutcome("error", "invalid", "Bundle must have at least one entry");
  }

  const isTransaction = body.type === "transaction";
  const tempIdMap = new Map<string, string>();

  const slots: Slot[] = [];

  for (let i = 0; i < body.entry.length; i++) {
    const rawEntry = body.entry[i]!;
    const result = validateEntry(rawEntry, config, tempIdMap);

    if (!result.error) {
      slots.push({ index: i, response: result.entry });
      continue;
    }

    if (validators) {
      const resourceError = validateResourceEntry(result.entry, validators);
      if (resourceError) {
        slots.push({ index: i, response: resourceError });
        continue;
      }
    }

    slots.push({
      index: i,
      validatable: { entry: result.entry, operation: result.error, index: i },
    });
  }

  if (isTransaction) {
    const hasErrors = slots.some((s) => s.response);
    if (hasErrors) {
      const responseEntries = slots.map((s) => s.response ?? makeTransactionError());
      return Response.json(
        { resourceType: "Bundle", type: "transaction-response", entry: responseEntries },
        { status: 200, headers: { "Content-Type": "application/fhir+json" } }
      );
    }

    const validEntries = slots.filter((s) => s.validatable).map((s) => s.validatable!);
    let responseEntries: BundleEntry[];
    try {
      responseEntries = store.transaction(() => {
        const results: BundleEntry[] = [];
        for (const { entry, operation } of validEntries) {
          results.push(executeEntry(entry, operation, store, config, tempIdMap));
        }
        return results;
      });
    } catch (err) {
      responseEntries = validEntries.map(() => ({
        response: {
          status: "422",
          outcome: {
            resourceType: "OperationOutcome",
            issue: [{ severity: "error", code: "transaction-failed", diagnostics: err instanceof Error ? err.message : "Transaction failed" }],
          },
        },
      }));
    }
    return Response.json(
      { resourceType: "Bundle", type: "transaction-response", entry: responseEntries },
      { status: 200, headers: { "Content-Type": "application/fhir+json" } }
    );
  }

  const responseEntries: BundleEntry[] = [];
  for (const slot of slots) {
    if (slot.response) {
      responseEntries.push(slot.response);
    } else if (slot.validatable) {
      try {
        responseEntries.push(executeEntry(slot.validatable.entry, slot.validatable.operation, store, config, tempIdMap));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        responseEntries.push({ response: { status: "500", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "exception", diagnostics: message }] } } });
      }
    }
  }

  return Response.json(
    { resourceType: "Bundle", type: "batch-response", entry: responseEntries },
    { status: 200, headers: { "Content-Type": "application/fhir+json" } }
  );
}
