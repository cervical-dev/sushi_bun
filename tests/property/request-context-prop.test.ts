import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";
import { resolveContext, parseAndValidateBody } from "../../src/handlers/request-context.ts";
import type { ResourceConfig } from "../../src/fhir/types.ts";

function makeConfig(type: string, interactions: string[]): ResourceConfig {
  return {
    type,
    interactions: new Set(interactions),
    searchParams: new Map(),
    operations: [],
    versioning: "versioned",
    readHistory: true,
    updateCreate: false,
    conditionalCreate: false,
    conditionalRead: "not-supported",
    conditionalUpdate: false,
    conditionalDelete: "not-supported",
  };
}

const idArb = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,15}$/);

describe("request-context properties", () => {
  it("config.type always wins: mismatched URL type returns 400, never uses URL type", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const config = makeConfig("Patient", ["read"]);
        const req = new Request(`http://localhost:3000/Observation/${id}`, { method: "GET" });
        const result = resolveContext(req, config, { interaction: "read", expectId: true });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.outcome.status).toBe(400);
      }),
      { numRuns: 500 }
    );
  });

  it("never throws on arbitrary paths", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (path) => {
        const config = makeConfig("Patient", ["read", "create", "delete"]);
        const safe = path.replace(/[\s#?]/g, "x");
        const req = new Request(`http://localhost:3000/${safe}`, { method: "GET" });
        expect(() => resolveContext(req, config, { interaction: "read", expectId: true })).not.toThrow();
      }),
      { numRuns: 1000 }
    );
  });

  it("If-Match round-trip: W/\"<vid>\" parses to vid; garbage returns 400", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 999999 }), async (vid) => {
        const config = makeConfig("Patient", ["update"]);
        const req = new Request("http://localhost:3000/Patient/aaa", {
          method: "PUT",
          headers: { "Content-Type": "application/fhir+json", "If-Match": `W/"${vid}"` },
          body: JSON.stringify({ resourceType: "Patient", id: "aaa" }),
        });
        const ctxResult = resolveContext(req, config, { interaction: "update", expectId: true });
        expect(ctxResult.ok).toBe(true);
        if (!ctxResult.ok) return;
        const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
          contentTypes: ["application/fhir+json", "application/json"],
          validateAs: "none",
          checkIdMatch: true,
          parseIfMatch: true,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.expectedVersion).toBe(vid);
      }),
      { numRuns: 500 }
    );

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0 && !/^W?\/?"\d+"$/.test(s.trim())),
        async (garbage) => {
          const config = makeConfig("Patient", ["update"]);
          const req = new Request("http://localhost:3000/Patient/aaa", {
            method: "PUT",
            headers: { "Content-Type": "application/fhir+json", "If-Match": garbage },
            body: JSON.stringify({ resourceType: "Patient", id: "aaa" }),
          });
          const ctxResult = resolveContext(req, config, { interaction: "update", expectId: true });
          expect(ctxResult.ok).toBe(true);
          if (!ctxResult.ok) return;
          const result = await parseAndValidateBody(req, ctxResult.ctx, undefined, {
            contentTypes: ["application/fhir+json", "application/json"],
            validateAs: "none",
            checkIdMatch: true,
            parseIfMatch: true,
          });
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.outcome.status).toBe(400);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("gating: disallowed interaction always returns 405", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const config = makeConfig("Patient", ["read"]);
        const req = new Request(`http://localhost:3000/Patient/${id}`, { method: "GET" });
        const result = resolveContext(req, config, { interaction: "delete", expectId: true });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.outcome.status).toBe(405);
      }),
      { numRuns: 500 }
    );
  });

  it("same input twice gives same status (deterministic preamble)", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const config = makeConfig("Patient", ["read"]);
        const url = `http://localhost:3000/Patient/${id}`;
        const a = resolveContext(new Request(url), config, { interaction: "read", expectId: true });
        const b = resolveContext(new Request(url), config, { interaction: "read", expectId: true });
        expect(a.ok).toBe(b.ok);
        if (a.ok && b.ok) {
          expect(a.ctx.id).toBe(b.ctx.id);
          expect(a.ctx.resourceType).toBe("Patient");
        }
      }),
      { numRuns: 500 }
    );
  });
});
