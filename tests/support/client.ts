import { expect } from "bun:test";
import type { FhirResource, OperationOutcome, Bundle } from "../../src/fhir/types.ts";

export interface FhirClient {
  baseUrl: string;

  create(resourceType: string, resource: Record<string, unknown>): Promise<FhirResponse>;
  read(resourceType: string, id: string): Promise<FhirResponse>;
  update(resourceType: string, id: string, resource: Record<string, unknown>, ifMatch?: string): Promise<FhirResponse>;
  delete(resourceType: string, id: string): Promise<FhirResponse>;
  search(resourceType: string, params?: Record<string, string>): Promise<FhirResponse>;
  history(resourceType: string, id?: string): Promise<FhirResponse>;
  vread(resourceType: string, id: string, versionId: string): Promise<FhirResponse>;
  patch(resourceType: string, id: string, ops: PatchOp[], ifMatch?: string): Promise<FhirResponse>;
  validate(resourceType: string, resource: Record<string, unknown>): Promise<FhirResponse>;
  batch(entries: BatchEntry[]): Promise<FhirResponse>;
  metadata(): Promise<FhirResponse>;
}

export interface FhirResponse {
  status: number;
  headers: Headers;
  body: any;
}

export interface PatchOp {
  op: string;
  path: string;
  value?: unknown;
}

export interface BatchEntry {
  resource: Record<string, unknown>;
  method: "POST" | "PUT" | "DELETE" | "GET";
  url: string;
}

export function createClient(baseUrl: string): FhirClient {
  async function request(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<FhirResponse> {
    const headers: Record<string, string> = { ...options?.headers };
    if (options?.body) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/fhir+json";
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const contentType = res.headers.get("content-type") || "";
    let body: any = null;
    if (contentType.includes("application/fhir+json") || contentType.includes("application/json")) {
      body = await res.json();
    }

    return { status: res.status, headers: res.headers, body };
  }

  return {
    baseUrl,

    async create(resourceType, resource) {
      return request("POST", `/${resourceType}`, {
        body: { resourceType, ...resource },
      });
    },

    async read(resourceType, id) {
      return request("GET", `/${resourceType}/${id}`);
    },

    async update(resourceType, id, resource, ifMatch) {
      const headers: Record<string, string> = {};
      if (ifMatch) headers["If-Match"] = ifMatch;
      return request("PUT", `/${resourceType}/${id}`, {
        body: { resourceType, ...resource, id },
        headers,
      });
    },

    async delete(resourceType, id) {
      return request("DELETE", `/${resourceType}/${id}`);
    },

    async search(resourceType, params) {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request("GET", `/${resourceType}${qs}`);
    },

    async history(resourceType, id) {
      const path = id ? `/${resourceType}/${id}/_history` : `/${resourceType}/_history`;
      return request("GET", path);
    },

    async vread(resourceType, id, versionId) {
      return request("GET", `/${resourceType}/${id}/_history/${versionId}`);
    },

    async patch(resourceType, id, ops, ifMatch) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json-patch+json",
      };
      if (ifMatch) headers["If-Match"] = ifMatch;
      return request("PATCH", `/${resourceType}/${id}`, {
        body: ops,
        headers,
      });
    },

    async validate(resourceType, resource) {
      return request("POST", `/${resourceType}/$validate`, {
        body: resource,
      });
    },

    async batch(entries) {
      const bundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: entries.map((e) => ({
          resource: e.resource,
          request: { method: e.method, url: e.url },
        })),
      };
      return request("POST", "/", { body: bundle });
    },

    async metadata() {
      return request("GET", "/metadata");
    },
  };
}

export function expectCreated(res: FhirResponse): void {
  expect(res.status).toBe(201);
  expect(res.body.resourceType).toBeDefined();
  expect(res.body.id).toBeDefined();
  expect(res.body.meta?.versionId).toBe("1");
}

export function expectOutcome(res: FhirResponse, status: number): OperationOutcome {
  expect(res.status).toBe(status);
  expect(res.body.resourceType).toBe("OperationOutcome");
  expect(res.body.issue).toBeDefined();
  expect(Array.isArray(res.body.issue)).toBe(true);
  return res.body as OperationOutcome;
}

export function expectEtag(res: FhirResponse, version: string): void {
  expect(res.headers.get("ETag")).toBe(`W/"${version}"`);
}

export function expectLocation(res: FhirResponse, resourceType: string, id: string, version?: string): void {
  const location = res.headers.get("Location");
  expect(location).toBeDefined();
  expect(location).toContain(`/${resourceType}/${id}`);
  if (version) {
    expect(location).toContain(`/_history/${version}`);
  }
}

export function expectBundle(res: FhirResponse, type: string): Bundle {
  expect(res.status).toBe(200);
  expect(res.body.resourceType).toBe("Bundle");
  expect(res.body.type).toBe(type);
  return res.body as Bundle;
}

export function expectLastModified(res: FhirResponse): void {
  expect(res.headers.get("Last-Modified")).toBeDefined();
}
