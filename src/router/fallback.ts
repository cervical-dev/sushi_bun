import { createOperationOutcome } from "../handlers/outcome.ts";
import { addStandardHeaders, isAcceptable, normalizeTrailingSlash } from "./middleware.ts";

export function fallbackFetch(req: Request): Response {
  const url = new URL(req.url);
  const normalizedPath = normalizeTrailingSlash(url.pathname);

  if (normalizedPath !== url.pathname) {
    url.pathname = normalizedPath;
    return new Response(null, { status: 301, headers: { Location: url.toString() } });
  }

  if (!isAcceptable(req.headers.get("Accept"))) {
    return addStandardHeaders(createOperationOutcome(
      "error",
      "not-acceptable",
      "Accept header must include application/fhir+json or application/json",
      406,
    ));
  }

  if (url.pathname === "/" && req.method === "GET") {
    return addStandardHeaders(createOperationOutcome(
      "information",
      "informational",
      "This is a FHIR R5 server. Use /metadata to discover capabilities.",
      200,
    ));
  }

  return addStandardHeaders(createOperationOutcome(
    "error",
    "not-found",
    `No route for ${req.method} ${url.pathname}`,
    404,
  ));
}
