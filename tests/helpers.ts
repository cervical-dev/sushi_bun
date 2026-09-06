import { Database } from "bun:sqlite";
import { parseCapabilityStatement } from "../src/fhir/capability.ts";
import { createResourceStore } from "../src/store/resource-store.ts";
import { sqliteProvider } from "../src/store/sqlite-provider.ts";
import { defaultHandlers } from "../src/handlers/default.ts";
import { loadValidators } from "../src/fhir/validator-loader.ts";
import { buildRoutes } from "../src/router/generator.ts";
import { addStandardHeaders, isAcceptable, normalizeTrailingSlash } from "../src/router/middleware.ts";
import type { RouteConfig } from "../src/fhir/types.ts";
import type { ResourceStore, StorageProvider } from "../src/store/types.ts";
import type { ValidatorRegistry } from "../src/fhir/validator-loader.ts";

export interface TestServer {
  baseUrl: string;
  store: ResourceStore;
  config: RouteConfig;
  server: ReturnType<typeof Bun.serve>;
  provider: StorageProvider;
  db: Database;
  validators: ValidatorRegistry;
  stop: () => void;
}

function createTestDb(path?: string): Database {
  const db = new Database(path ?? ":memory:");
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.run(`
    CREATE TABLE IF NOT EXISTS resources (
      id            TEXT    NOT NULL,
      resource_type TEXT    NOT NULL,
      version_id    INTEGER NOT NULL DEFAULT 1,
      last_updated  TEXT    NOT NULL,
      is_deleted    INTEGER NOT NULL DEFAULT 0,
      data          TEXT    NOT NULL,
      PRIMARY KEY (id, resource_type)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS resources_history (
      id            TEXT    NOT NULL,
      resource_type TEXT    NOT NULL,
      version_id    INTEGER NOT NULL,
      last_updated  TEXT    NOT NULL,
      data          TEXT    NOT NULL,
      PRIMARY KEY (id, resource_type, version_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type)");
  db.run("CREATE INDEX IF NOT EXISTS idx_resources_type_deleted ON resources(resource_type, is_deleted)");
  return db;
}

export async function createTestServer(capabilityPath: string): Promise<TestServer> {
  const capabilityFile = Bun.file(capabilityPath);
  const capabilityJson = (await capabilityFile.json()) as Record<string, unknown>;
  const config = parseCapabilityStatement(capabilityJson as any);

  const capabilityDir = capabilityPath.includes("/")
    ? capabilityPath.substring(0, capabilityPath.lastIndexOf("/"))
    : "fsh-generated/resources";
  const sdDir = capabilityDir || "fsh-generated/resources";
  const validators = await loadValidators(sdDir);

  const db = createTestDb();
  const store = createResourceStore(db);
  const provider = sqliteProvider();
  const handlers = await defaultHandlers(store, validators, provider.translateFilters);
  const routes = buildRoutes(config, capabilityJson, handlers);

  const server = Bun.serve({
    port: 0,
    routes,
    fetch(req) {
      const url = new URL(req.url);
      const normalizedPath = normalizeTrailingSlash(url.pathname);

      if (normalizedPath !== url.pathname) {
        url.pathname = normalizedPath;
        return new Response(null, { status: 301, headers: { Location: url.toString() } });
      }

      if (!isAcceptable(req.headers.get("Accept"))) {
        return addStandardHeaders(Response.json(
          {
            resourceType: "OperationOutcome",
            issue: [{ severity: "error", code: "not-acceptable", diagnostics: "Accept header must include application/fhir+json or application/json" }],
          },
          { status: 406, headers: { "Content-Type": "application/fhir+json" } }
        ));
      }

      return addStandardHeaders(Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [{ severity: "error", code: "not-found", diagnostics: `No route for ${req.method} ${url.pathname}` }],
        },
        { status: 404, headers: { "Content-Type": "application/fhir+json" } }
      ));
    },
  });

  return {
    baseUrl: server.url.toString(),
    store,
    config,
    server,
    provider,
    db,
    validators,
    stop: () => {
      server.stop();
      db.close();
    },
  };
}

export function createTestStore(): { store: ResourceStore; db: Database } {
  const db = createTestDb();
  return { store: createResourceStore(db), db };
}

export function samplePatient(overrides?: Record<string, unknown>) {
  return {
    resourceType: "Patient",
    name: [{ family: "Smith", given: ["John"] }],
    gender: "male",
    birthDate: "1990-01-15",
    identifier: [{ system: "http://example.org/mrn", value: "12345" }],
    ...overrides,
  };
}

export function sampleObservation(patientRef: string, overrides?: Record<string, unknown>) {
  return {
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    subject: { reference: patientRef },
    ...overrides,
  };
}

export async function createTestServerWithCapability(capability: Record<string, unknown>): Promise<TestServer> {
  const config = parseCapabilityStatement(capability as any);
  const db = createTestDb();
  const store = createResourceStore(db);
  const provider = sqliteProvider();
  const validators = await loadValidators("fsh-generated/resources");
  const handlers = await defaultHandlers(store, validators, provider.translateFilters);
  const routes = buildRoutes(config, capability, handlers);

  const server = Bun.serve({
    port: 0,
    routes,
    fetch(req) {
      const url = new URL(req.url);
      const normalizedPath = normalizeTrailingSlash(url.pathname);
      if (normalizedPath !== url.pathname) {
        url.pathname = normalizedPath;
        return new Response(null, { status: 301, headers: { Location: url.toString() } });
      }
      if (!isAcceptable(req.headers.get("Accept"))) {
        return addStandardHeaders(Response.json(
          { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-acceptable", diagnostics: "Accept header must include application/fhir+json or application/json" }] },
          { status: 406, headers: { "Content-Type": "application/fhir+json" } }
        ));
      }
      return addStandardHeaders(Response.json(
        { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-found", diagnostics: `No route for ${req.method} ${url.pathname}` }] },
        { status: 404, headers: { "Content-Type": "application/fhir+json" } }
      ));
    },
  });

  return {
    baseUrl: server.url.toString(),
    store,
    config,
    server,
    provider,
    db,
    validators,
    stop: () => { server.stop(); db.close(); },
  };
}
