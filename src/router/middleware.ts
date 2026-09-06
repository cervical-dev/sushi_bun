const JSON_MEDIA_TYPES = [
  "application/fhir+json",
  "application/json",
];

export function isAcceptable(accept: string | null): boolean {
  if (!accept || accept === "*/*") return true;
  const types = accept.split(",").map((t) => t.trim().split(";")[0]!.toLowerCase());
  return types.some(
    (t) =>
      JSON_MEDIA_TYPES.includes(t) ||
      t === "*/*"
  );
}

export function addStandardHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Date", new Date().toUTCString());
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, If-Match, If-None-Match, Prefer, Accept");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function normalizeTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}
