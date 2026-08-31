import type { RouteConfig, Bundle, BundleEntry, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

interface EntryResult {
  entry: BundleEntry;
  error?: string;
}

function validateEntry(
  entry: BundleEntry,
  config: RouteConfig,
  tempIdMap: Map<string, string>
): EntryResult | null {
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

  const resourceConfig = config.resources.get(resourceType)!;

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

export async function handleBatch(
  req: Request,
  config: RouteConfig,
  store: ResourceStore
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

  const validations: Array<{ entry: BundleEntry; operation: string }> = [];
  const preErrors: BundleEntry[] = [];

  for (const entry of body.entry) {
    const result = validateEntry(entry, config, tempIdMap);
    if (result) {
      if (result.error) {
        validations.push({ entry: result.entry, operation: result.error });
      } else {
        preErrors.push(result.entry);
      }
    }
  }

  if (isTransaction && preErrors.length > 0) {
    const responseEntries: BundleEntry[] = validations.map((v) => ({
      response: {
        status: "422",
        outcome: {
          resourceType: "OperationOutcome",
          issue: [{ severity: "error", code: "transaction-failed", diagnostics: "Transaction aborted due to validation errors" }],
        },
      },
    }));
    responseEntries.push(...preErrors);
    return Response.json(
      { resourceType: "Bundle", type: "transaction-response", entry: responseEntries },
      { status: 200, headers: { "Content-Type": "application/fhir+json" } }
    );
  }

  if (!isTransaction && preErrors.length > 0) {
    const responseEntries: BundleEntry[] = [...preErrors];
    for (const v of validations) {
      try {
        responseEntries.push(executeEntry(v.entry, v.operation, store, config, tempIdMap));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        responseEntries.push({ response: { status: "500", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "exception", diagnostics: message }] } } });
      }
    }
    return Response.json(
      { resourceType: "Bundle", type: "batch-response", entry: responseEntries },
      { status: 200, headers: { "Content-Type": "application/fhir+json" } }
    );
  }

  let responseEntries: BundleEntry[];

  if (isTransaction) {
    try {
      responseEntries = store.transaction(() => {
        const results: BundleEntry[] = [];
        for (const { entry, operation } of validations) {
          results.push(executeEntry(entry, operation, store, config, tempIdMap));
        }
        return results;
      });
    } catch (err) {
      responseEntries = validations.map(() => ({
        response: {
          status: "422",
          outcome: {
            resourceType: "OperationOutcome",
            issue: [{ severity: "error", code: "transaction-failed", diagnostics: err instanceof Error ? err.message : "Transaction failed" }],
          },
        },
      }));
    }
  } else {
    responseEntries = [];
    for (const { entry, operation } of validations) {
      try {
        responseEntries.push(executeEntry(entry, operation, store, config, tempIdMap));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        responseEntries.push({ response: { status: "500", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "exception", diagnostics: message }] } } });
      }
    }
  }

  const responseType = isTransaction ? "transaction-response" : "batch-response";
  return Response.json(
    { resourceType: "Bundle", type: responseType, entry: responseEntries },
    { status: 200, headers: { "Content-Type": "application/fhir+json" } }
  );
}
