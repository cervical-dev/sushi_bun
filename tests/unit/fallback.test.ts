import { describe, expect, it } from "bun:test";
import { fallbackFetch } from "../../src/router/fallback.ts";

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

describe("shared fallback fetch", () => {
  it("301s trailing-slash paths with Location", () => {
    const res = fallbackFetch(req("/Patient/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("http://localhost/Patient");
  });

  it("406s unacceptable Accept with OperationOutcome", async () => {
    const res = fallbackFetch(req("/Patient", { headers: { Accept: "application/xml" } }));
    expect(res.status).toBe(406);
    const body = (await res.json()) as any;
    expect(body.resourceType).toBe("OperationOutcome");
    expect(body.issue[0].code).toBe("not-acceptable");
  });

  it("answers GET / with informational outcome", async () => {
    const res = fallbackFetch(req("/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.issue[0].code).toBe("informational");
  });

  it("404s unknown routes with method and path", async () => {
    const res = fallbackFetch(req("/nope"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.issue[0].code).toBe("not-found");
    expect(body.issue[0].diagnostics).toBe("No route for GET /nope");
  });

  it("sets standard headers on every response", () => {
    for (const res of [fallbackFetch(req("/nope")), fallbackFetch(req("/"))]) {
      expect(res.headers.get("Date")).not.toBeNull();
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });
});
