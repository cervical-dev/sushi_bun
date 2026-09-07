import type { ResourceConfig, FhirResource } from "../fhir/types.ts";
import type { ResourceStore } from "../store/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { resolveContext, parseAndValidateBody, respondWithResource } from "./request-context.ts";

export async function handleCreate(
  req: Request,
  config: ResourceConfig,
  store: ResourceStore,
  validators?: ValidatorRegistry
): Promise<Response> {
  const resolved = resolveContext(req, config, { interaction: "create" });
  if (!resolved.ok) return resolved.outcome;
  const { resourceType, baseUrl } = resolved.ctx;

  const parsed = await parseAndValidateBody(req, resolved.ctx, validators, {
    contentTypes: ["application/fhir+json", "application/json"],
    validateAs: "resource",
  });
  if (!parsed.ok) return parsed.outcome;
  const body = parsed.body as FhirResource;

  const resource = store.create(resourceType, body);

  return respondWithResource(resource, baseUrl, 201);
}
