import type { ResourceConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import { createOperationOutcome } from "./outcome.ts";
import { resolveContext, respondDeleted } from "./request-context.ts";

export function handleDelete(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const resolved = resolveContext(req, config, { interaction: "delete", expectId: true });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, id } = resolved.ctx;

  const deleted = store.softDelete(resourceType, id!);
  if (!deleted && !store.exists(resourceType, id!)) {
    return createOperationOutcome("error", "not-found", `${resourceType}/${id} not found`, 404);
  }

  return respondDeleted(store, resourceType, id!);
}
