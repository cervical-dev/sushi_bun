import type { ResourceConfig, FhirResource, StructureDefinition } from "../fhir/types.ts";
import { getProfileUrl } from "../fhir/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { validateResource } from "../fhir/validator.ts";
import { createOperationOutcome, createOperationOutcomeFromIssues } from "./metadata.ts";
import type { PatchOp } from "../fhir/patch.ts";

export interface RequestContext {
  resourceType: string;
  id?: string;
  vid?: number;
  baseUrl: string;
  url: URL;
}

export interface ResolveOptions {
  interaction: string;
  expectId?: boolean;
  expectVid?: boolean;
}

export type ResolveResult =
  | { ok: true; ctx: RequestContext }
  | { ok: false; outcome: Response };

export interface ParseOptions {
  contentTypes: string[];
  validateAs: "resource" | "patch-ops" | "none";
  checkIdMatch?: boolean;
  parseIfMatch?: boolean;
}

export type ParseResult =
  | { ok: true; body: FhirResource | PatchOp[]; sd?: StructureDefinition; expectedVersion?: number }
  | { ok: false; outcome: Response };

export function resolveContext(
  req: Request,
  config: ResourceConfig,
  opts: ResolveOptions
): ResolveResult {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const urlType = pathParts[0];
  const baseUrl = `${url.protocol}//${url.host}`;

  if (!urlType || urlType !== config.type) {
    return {
      ok: false,
      outcome: createOperationOutcome(
        "error",
        "invalid",
        `Resource type in URL (${urlType ?? "missing"}) does not match ${config.type}`
      ),
    };
  }

  if (!config.interactions.has(opts.interaction)) {
    return {
      ok: false,
      outcome: createOperationOutcome(
        "error",
        "not-supported",
        `${capitalize(opts.interaction)} not supported for ${config.type}`,
        405
      ),
    };
  }

  let id: string | undefined;
  if (opts.expectId) {
    id = pathParts[1];
    if (!id) {
      return {
        ok: false,
        outcome: createOperationOutcome("error", "invalid", "Missing id in URL"),
      };
    }
  } else {
    id = pathParts[1];
  }

  let vid: number | undefined;
  if (opts.expectVid) {
    const vidStr = pathParts[3];
    const parsed = vidStr !== undefined ? parseInt(vidStr, 10) : NaN;
    if (!vidStr || isNaN(parsed)) {
      return {
        ok: false,
        outcome: createOperationOutcome("error", "invalid", "Invalid version id"),
      };
    }
    vid = parsed;
  }

  return { ok: true, ctx: { resourceType: config.type, id, vid, baseUrl, url } };
}

export async function parseAndValidateBody(
  req: Request,
  ctx: RequestContext,
  validators: ValidatorRegistry | undefined,
  opts: ParseOptions
): Promise<ParseResult> {
  const contentType = req.headers.get("Content-Type") ?? "";
  const contentOk = opts.contentTypes.some((t) => contentType.includes(t));
  if (!contentOk) {
    return {
      ok: false,
      outcome: createOperationOutcome(
        "error",
        "unsupported",
        `Content-Type must be ${opts.contentTypes.join(" or ")}`,
        415
      ),
    };
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      outcome: createOperationOutcome("error", "invalid", "Request body is not valid JSON"),
    };
  }

  let expectedVersion: number | undefined;
  if (opts.parseIfMatch) {
    const ifMatch = req.headers.get("If-Match");
    if (ifMatch) {
      const versionMatch = ifMatch.match(/^W?\/?"(\d+)"$/);
      if (!versionMatch) {
        return {
          ok: false,
          outcome: createOperationOutcome(
            "error",
            "invalid",
            "If-Match header must be a weak ETag with version id"
          ),
        };
      }
      expectedVersion = parseInt(versionMatch[1]!, 10);
    }
  }

  if (opts.validateAs === "patch-ops") {
    if (!Array.isArray(raw) || raw.length === 0) {
      return {
        ok: false,
        outcome: createOperationOutcome(
          "error",
          "invalid",
          "PATCH body must be a non-empty array of operations"
        ),
      };
    }
    return { ok: true, body: raw as PatchOp[], expectedVersion };
  }

  const body = raw as FhirResource;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      outcome: createOperationOutcome("error", "invalid", "Request body must be a resource"),
    };
  }

  if (body.resourceType !== ctx.resourceType) {
    return {
      ok: false,
      outcome: createOperationOutcome(
        "error",
        "invalid",
        `Resource type in body (${body.resourceType}) does not match URL (${ctx.resourceType})`
      ),
    };
  }

  if (opts.checkIdMatch && body.id && ctx.id && body.id !== ctx.id) {
    return {
      ok: false,
      outcome: createOperationOutcome(
        "error",
        "invalid",
        `Resource id in body (${body.id}) does not match URL (${ctx.id})`
      ),
    };
  }

  if (opts.validateAs === "resource" && validators) {
    const toValidate =
      opts.checkIdMatch && ctx.id ? ({ ...body, id: ctx.id } as Record<string, unknown>) : (body as Record<string, unknown>);
    const profileUrl = getProfileUrl(toValidate);
    const sd = validators.getValidator(ctx.resourceType, profileUrl);
    if (sd) {
      const validation = validateResource(toValidate, sd);
      if (!validation.valid) {
        return { ok: false, outcome: createOperationOutcomeFromIssues(validation.issues, 422) };
      }
      return { ok: true, body, sd, expectedVersion };
    }
  }

  return { ok: true, body, expectedVersion };
}

export function respondWithResource(
  resource: FhirResource,
  baseUrl: string,
  status: 200 | 201 = 200
): Response {
  return Response.json(resource, {
    status,
    headers: {
      "Content-Type": "application/fhir+json",
      Location: `${baseUrl}/${resource.resourceType}/${resource.id}/_history/${resource.meta?.versionId}`,
      ETag: `W/"${resource.meta?.versionId}"`,
      "Last-Modified": resource.meta?.lastUpdated ?? new Date().toISOString(),
    },
  });
}

function capitalize(s: string): string {
  if (s.startsWith("history")) return "History";
  if (s === "search-type") return "Search";
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
