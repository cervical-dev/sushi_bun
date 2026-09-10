// byoh.ts — Bring Your Own Handlers authoring seam.
// Re-exports the utility surface a BYOH author needs, organized by concern.
// This file is external-facing only: internal handler modules keep direct imports
// so no cycles are introduced.

// ── Context parsing ──────────────────────────────────────────────────────────
export {
  resolveContext,
  parseAndValidateBody,
} from "./handlers/request-context.ts";

// ── Response building ────────────────────────────────────────────────────────
export {
  respondWithResource,
  respondMissing,
  respondGone,
  respondDeleted,
  deletedResponse,
  historyEntry,
} from "./handlers/request-context.ts";

// ── ETag / header helpers ────────────────────────────────────────────────────
export {
  etag,
  lastModified,
  historyPath,
} from "./handlers/request-context.ts";

// ── OperationOutcome ─────────────────────────────────────────────────────────
export {
  buildOperationOutcome,
  createOperationOutcome,
  createOperationOutcomeFromIssues,
} from "./handlers/outcome.ts";

// ── Search / paging ──────────────────────────────────────────────────────────
export {
  parseSearchParams,
  parsePaging,
} from "./router/params.ts";

// ── JSON Patch ───────────────────────────────────────────────────────────────
export {
  applyPatch,
  PatchError,
} from "./fhir/patch.ts";

// ── Validation ───────────────────────────────────────────────────────────────
export { loadValidators } from "./fhir/validator-loader.ts";
export { validateResource } from "./fhir/validator.ts";

// ── Types (used in handler signatures and return values) ──────────────────────
export type {
  RequestContext,
  ResolveOptions,
  ResolveResult,
  ParseOptions,
  ParseResult,
  HistoryEntryInput,
} from "./handlers/request-context.ts";
export type { Paging } from "./router/params.ts";
export type { PatchOp } from "./fhir/patch.ts";
export type { ValidatorRegistry } from "./fhir/validator-loader.ts";
export type { ValidationOptions } from "./fhir/validator.ts";
export type { HandlerProvider } from "./handlers/types.ts";
export type {
  ResourceConfig,
  RouteConfig,
  FhirResource,
  Bundle,
  BundleEntry,
  BundleLink,
  OperationOutcome,
  SearchFilter,
  SearchParamConfig,
  StructureDefinition,
  ValidationIssue,
} from "./fhir/types.ts";
export type { ResourceStore } from "./store/types.ts";
