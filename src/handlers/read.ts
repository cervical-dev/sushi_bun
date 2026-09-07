import type { ResourceConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import { createOperationOutcome } from "./outcome.ts";
import {
  resolveContext,
  respondWithResource,
  respondMissing,
  respondGone,
} from "./request-context.ts";

export function handleRead(req: Request, config: ResourceConfig, store: ResourceStore): Response {
  const probeUrl = new URL(req.url);
  const probeParts = probeUrl.pathname.split("/").filter(Boolean);
  const isVread = probeParts.length >= 4 && probeParts[2] === "_history";

  if (isVread) {
    const resolved = resolveContext(req, config, {
      interaction: "history-instance",
      expectId: true,
      expectVid: true,
    });
    if (!resolved.ok) return resolved.outcome;
    const { resourceType, id, vid, baseUrl } = resolved.ctx;
    const versionId = vid!;

    const resource = store.readVersion(resourceType, id!, versionId);
    if (!resource) {
      return createOperationOutcome("error", "not-found", `Version ${versionId} of ${resourceType}/${id} not found`, 404);
    }

    const current = store.currentVersion(resourceType, id!);
    if (current?.isDeleted && current.versionId === versionId) {
      return respondGone(store, resourceType, id!);
    }

    return respondWithResource(resource, baseUrl, 200);
  }

  const resolved = resolveContext(req, config, { interaction: "read", expectId: true });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, id, baseUrl } = resolved.ctx;

  const resource = store.read(resourceType, id!);
  if (!resource) {
    return respondMissing(store, resourceType, id!);
  }

  return respondWithResource(resource, baseUrl, 200, { location: false });
}
