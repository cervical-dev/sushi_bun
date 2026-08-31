import type { RouteConfig, Bundle, BundleEntry, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { createOperationOutcome } from "./metadata.ts";

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
  const responseEntries: BundleEntry[] = [];
  const tempIdMap = new Map<string, string>();

  for (const entry of body.entry) {
    if (!entry.request) {
      responseEntries.push({
        response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "Entry must have a request" }] } },
      });
      continue;
    }

    const { method, url } = entry.request;
    const urlParts = url.split("/").filter(Boolean);
    const resourceType = urlParts[0]!;
    const id = urlParts[1];

    const resourceConfig = config.resources.get(resourceType);
    if (!resourceConfig) {
      responseEntries.push({
        response: { status: "404", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-found", diagnostics: `Resource type ${resourceType} not supported` }] } },
      });
      continue;
    }

    try {
      switch (method) {
        case "POST": {
          if (!resourceConfig.interactions.has("create")) {
            responseEntries.push({ response: { status: "405", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: `Create not supported for ${resourceType}` }] } } });
            break;
          }
          const resource = entry.resource as FhirResource;
          if (!resource) {
            responseEntries.push({ response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "POST entry must have a resource" }] } } });
            break;
          }
          const created = store.create(resourceType, resource);
          if (entry.fullUrl?.startsWith("urn:uuid:")) {
            tempIdMap.set(entry.fullUrl, `${resourceType}/${created.id}`);
          }
          responseEntries.push({
            fullUrl: `${resourceType}/${created.id}`,
            resource: created,
            response: {
              status: "201",
              location: `${resourceType}/${created.id}/_history/${created.meta?.versionId}`,
              etag: `W/"${created.meta?.versionId}"`,
            },
          });
          break;
        }
        case "PUT": {
          if (!id) {
            responseEntries.push({ response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "PUT requires an id in the URL" }] } } });
            break;
          }
          if (!resourceConfig.interactions.has("update")) {
            responseEntries.push({ response: { status: "405", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: `Update not supported for ${resourceType}` }] } } });
            break;
          }
          const putResource = entry.resource as FhirResource;
          if (!putResource) {
            responseEntries.push({ response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "PUT entry must have a resource" }] } } });
            break;
          }
          let resolvedId = id;
          if (id.startsWith("urn:")) {
            resolvedId = tempIdMap.get(id)?.split("/").pop() ?? id;
          }
          const updated = store.update(resourceType, resolvedId, { ...putResource, id: resolvedId });
          responseEntries.push({
            fullUrl: `${resourceType}/${updated.id}`,
            resource: updated,
            response: {
              status: "200",
              location: `${resourceType}/${updated.id}/_history/${updated.meta?.versionId}`,
              etag: `W/"${updated.meta?.versionId}"`,
            },
          });
          break;
        }
        case "DELETE": {
          if (!resourceConfig.interactions.has("delete")) {
            responseEntries.push({ response: { status: "405", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported", diagnostics: `Delete not supported for ${resourceType}` }] } } });
            break;
          }
          const deleteId = id ?? (entry.resource as FhirResource)?.id;
          if (!deleteId) {
            responseEntries.push({ response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "DELETE requires an id" }] } } });
            break;
          }
          const deleted = store.softDelete(resourceType, deleteId);
          responseEntries.push({
            response: { status: deleted ? "204" : "404" },
          });
          break;
        }
        case "GET": {
          if (!id) {
            responseEntries.push({ response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: "GET in bundle requires an id" }] } } });
            break;
          }
          const readResource = store.read(resourceType, id);
          if (readResource) {
            responseEntries.push({
              fullUrl: `${resourceType}/${readResource.id}`,
              resource: readResource,
              response: { status: "200" },
            });
          } else {
            responseEntries.push({ response: { status: "404" } });
          }
          break;
        }
        default:
          responseEntries.push({ response: { status: "400", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: `Unsupported method: ${method}` }] } } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      responseEntries.push({ response: { status: "500", outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "exception", diagnostics: message }] } } });
    }
  }

  const responseType = isTransaction ? "transaction-response" : "batch-response";
  const responseBundle: Bundle = {
    resourceType: "Bundle",
    type: responseType,
    entry: responseEntries,
  };

  return Response.json(responseBundle, {
    status: 200,
    headers: {
      "Content-Type": "application/fhir+json",
    },
  });
}
