import type { RouteConfig, Bundle, BundleEntry, FhirResource } from "../fhir/types.ts";
import { getProfileUrl } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { validateResource } from "../fhir/validator.ts";
import { createOperationOutcome, buildOperationOutcome } from "./outcome.ts";
import { etag, historyPath, deletedResponse } from "./request-context.ts";
import { applyPatch, PatchError } from "../fhir/patch.ts";

function entryError(status: string, code: string, diagnostics: string): BundleEntry {
  return { response: { status, outcome: buildOperationOutcome("error", code, diagnostics) } };
}

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
  config: RouteConfig
): { entry: BundleEntry; error?: string } {
  if (!entry.request) {
    return { entry: entryError("400", "invalid", "Entry must have a request") };
  }

  const { method, url } = entry.request;
  const urlParts = url.split("/").filter(Boolean);
  const resourceType = urlParts[0]!;
  const id = urlParts[1];

  const resourceConfig = config.resources.get(resourceType);
  if (!resourceConfig) {
    return { entry: entryError("404", "not-found", `Resource type ${resourceType} not supported`) };
  }

  switch (method) {
    case "POST": {
      if (!resourceConfig.interactions.has("create")) {
        return { entry: entryError("405", "not-supported", `Create not supported for ${resourceType}`) };
      }
      if (!entry.resource) {
        return { entry: entryError("400", "invalid", "POST entry must have a resource") };
      }
      const bodyResourceType = (entry.resource as FhirResource).resourceType;
      if (bodyResourceType && bodyResourceType !== resourceType) {
        return { entry: entryError("400", "invalid", `Resource type ${bodyResourceType} does not match URL type ${resourceType}`) };
      }
      return { entry, error: "create" };
    }
    case "PUT": {
      if (!id) {
        return { entry: entryError("400", "invalid", "PUT requires an id in the URL") };
      }
      if (!resourceConfig.interactions.has("update")) {
        return { entry: entryError("405", "not-supported", `Update not supported for ${resourceType}`) };
      }
      if (!entry.resource) {
        return { entry: entryError("400", "invalid", "PUT entry must have a resource") };
      }
      return { entry, error: "update" };
    }
    case "DELETE": {
      if (!resourceConfig.interactions.has("delete")) {
        return { entry: entryError("405", "not-supported", `Delete not supported for ${resourceType}`) };
      }
      const deleteId = id ?? (entry.resource as FhirResource)?.id;
      if (!deleteId) {
        return { entry: entryError("400", "invalid", "DELETE requires an id") };
      }
      return { entry, error: "delete" };
    }
    case "PATCH": {
      if (!resourceConfig.interactions.has("patch")) {
        return { entry: entryError("405", "not-supported", `Patch not supported for ${resourceType}`) };
      }
      if (!id) {
        return { entry: entryError("400", "invalid", "PATCH requires an id in the URL") };
      }
      return { entry, error: "patch" };
    }
    case "GET": {
      if (!id) {
        return { entry: entryError("400", "invalid", "GET in bundle requires an id") };
      }
      if (!resourceConfig.interactions.has("read")) {
        return { entry: entryError("405", "not-supported", `Read not supported for ${resourceType}`) };
      }
      return { entry, error: "read" };
    }
    default:
      return { entry: entryError("400", "invalid", `Unsupported method: ${method}`) };
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

  function rewriteReferences(obj: unknown): unknown {
    if (typeof obj === "string") {
      if (obj.startsWith("urn:uuid:")) {
        return tempIdMap.get(obj) ?? obj;
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(rewriteReferences);
    }
    if (typeof obj === "object" && obj !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = rewriteReferences(value);
      }
      return result;
    }
    return obj;
  }

  switch (operation) {
    case "create": {
      const resource = rewriteReferences(entry.resource) as FhirResource;
      const created = store.create(resourceType, resource);
      if (entry.fullUrl?.startsWith("urn:uuid:")) {
        tempIdMap.set(entry.fullUrl, `${resourceType}/${created.id}`);
      }
      return {
        fullUrl: `${resourceType}/${created.id}`,
        resource: created,
        response: {
          status: "201",
          location: historyPath(resourceType, created.id!, created.meta?.versionId ?? 1),
          etag: etag(created.meta?.versionId ?? 1),
        },
      };
    }
    case "update": {
      let resolvedId = id!;
      if (id!.startsWith("urn:")) {
        resolvedId = tempIdMap.get(id!)?.split("/").pop() ?? id!;
      }
      const putResource = rewriteReferences(entry.resource) as FhirResource;
      const updated = store.update(resourceType, resolvedId, { ...putResource, id: resolvedId });
      return {
        fullUrl: `${resourceType}/${updated.id}`,
        resource: updated,
        response: {
          status: "200",
          location: historyPath(resourceType, updated.id!, updated.meta?.versionId ?? 1),
          etag: etag(updated.meta?.versionId ?? 1),
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
      if (store.isDeleted(resourceType, id!)) {
        return { response: deletedResponse(store, resourceType, id!) };
      }
      return { response: { status: "404" } };
    }
    case "patch": {
      const existing = store.read(resourceType, id!);
      if (!existing) {
        if (store.isDeleted(resourceType, id!)) {
          return { response: deletedResponse(store, resourceType, id!) };
        }
        return { response: { status: "404" } };
      }
      const patchOps = entry.resource as unknown as Array<{ op: string; path: string; value?: unknown }>;
      if (!Array.isArray(patchOps) || patchOps.length === 0) {
        return entryError("422", "invalid", "PATCH requires a non-empty array of operations");
      }
      try {
        const patched = applyPatch(existing as Record<string, unknown>, patchOps);
        if ((patched as FhirResource).resourceType !== resourceType) {
          return entryError("422", "invalid", "PATCH cannot change resourceType");
        }
        const updated = store.update(resourceType, id!, { ...patched, id: id! } as FhirResource);
        return {
          fullUrl: `${resourceType}/${updated.id}`,
          resource: updated,
        response: {
          status: "200",
          location: historyPath(resourceType, updated.id!, updated.meta?.versionId ?? 1),
          etag: etag(updated.meta?.versionId ?? 1),
        },
      };
    } catch (err) {
        if (err instanceof PatchError) {
          const code = err.message.includes("test failed") ? "precondition-failed" : "invalid";
          return entryError("422", code, err.message);
        }
        return entryError("422", "invalid", err instanceof Error ? err.message : "Patch failed");
      }
    }
    default:
      return entryError("400", "invalid", `Unsupported method: ${method}`);
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
  return entryError("422", "transaction-failed", "Transaction aborted due to validation errors");
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

  const isTransaction = body.type === "transaction";
  const tempIdMap = new Map<string, string>();

  const slots: Slot[] = [];

  for (let i = 0; i < body.entry!.length; i++) {
    const rawEntry = body.entry![i]!;
    const result = validateEntry(rawEntry, config);

    if (!result.error) {
      slots.push({ index: i, response: result.entry });
      continue;
    }

    if (validators && (result.error === "create" || result.error === "update")) {
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

    const operationPhase: Record<string, number> = { delete: 0, create: 1, update: 2, patch: 2, read: 3 };
    const sortedEntries = [...validEntries].sort((a, b) => (operationPhase[a.operation] ?? 4) - (operationPhase[b.operation] ?? 4));

    let responseEntries: BundleEntry[];
    try {
      const sortedResults = store.transaction(() => {
        const results: Array<{ index: number; entry: BundleEntry }> = [];
        for (const ve of sortedEntries) {
          results.push({ index: ve.index, entry: executeEntry(ve.entry, ve.operation, store, config, tempIdMap) });
        }
        return results;
      });
      responseEntries = new Array(validEntries.length);
      for (const r of sortedResults) {
        responseEntries[r.index] = r.entry;
      }
    } catch (err) {
      responseEntries = validEntries.map(() =>
        entryError("422", "transaction-failed", err instanceof Error ? err.message : "Transaction failed")
      );
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
        const status = message === "not-found" ? "404" : "500";
        responseEntries.push(entryError(status, status === "404" ? "not-found" : "exception", message));
      }
    }
  }

  return Response.json(
    { resourceType: "Bundle", type: "batch-response", entry: responseEntries },
    { status: 200, headers: { "Content-Type": "application/fhir+json" } }
  );
}
