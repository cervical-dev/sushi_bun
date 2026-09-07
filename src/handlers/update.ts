import type { ResourceConfig, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { createOperationOutcome } from "./outcome.ts";
import { resolveContext, parseAndValidateBody, respondWithResource } from "./request-context.ts";

export async function handleUpdate(
  req: Request,
  config: ResourceConfig,
  store: ResourceStore,
  validators?: ValidatorRegistry
): Promise<Response> {
  const resolved = resolveContext(req, config, { interaction: "update", expectId: true });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, id, baseUrl } = resolved.ctx;
  const resourceId = id!;

  const parsed = await parseAndValidateBody(req, resolved.ctx, validators, {
    contentTypes: ["application/fhir+json", "application/json"],
    validateAs: "resource",
    checkIdMatch: true,
    parseIfMatch: true,
  });
  if (!parsed.ok) return parsed.outcome;
  const body = parsed.body as FhirResource;
  const expectedVersion = parsed.expectedVersion;

  let resource: FhirResource;
  try {
    resource = store.update(resourceType, resourceId, { ...body, id: resourceId }, expectedVersion);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "not-found") {
        if (config.updateCreate) {
          resource = store.create(resourceType, body, resourceId);
          return respondWithResource(resource, baseUrl, 201);
        }
        return createOperationOutcome("error", "not-found", `${resourceType}/${resourceId} not found`, 404);
      }
      if (err.message === "version-conflict") {
        return createOperationOutcome("error", "conflict", "Version mismatch. Use correct If-Match header.", 412);
      }
    }
    return createOperationOutcome("error", "exception", "Internal server error", 500);
  }

  return respondWithResource(resource, baseUrl, 200);
}
