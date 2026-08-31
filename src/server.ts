import { Database } from "bun:sqlite";
import { parseCapabilityStatement } from "./fhir/capability.ts";
import { createResourceStore } from "./store/resource-store.ts";
import { buildRoutes } from "./router/generator.ts";
import type { RouteConfig } from "./fhir/types.ts";

export interface ServerConfig {
  port?: number;
  dbPath?: string;
  capabilityPath: string;
}

export async function createServer(serverConfig: ServerConfig) {
  const capabilityFile = Bun.file(serverConfig.capabilityPath);
  const capabilityJson = (await capabilityFile.json()) as Record<string, unknown>;
  const config: RouteConfig = parseCapabilityStatement(capabilityJson as any);

  const db = createDatabase(serverConfig.dbPath);
  const store = createResourceStore(db);
  const routes = buildRoutes(config, store, capabilityJson);

  const server = Bun.serve({
    port: serverConfig.port ?? 3000,
    routes,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/" && req.method === "GET") {
        return Response.json(
          {
            resourceType: "OperationOutcome",
            issue: [
              {
                severity: "information",
                code: "informational",
                diagnostics: "This is a FHIR R5 server. Use /metadata to discover capabilities.",
              },
            ],
          },
          {
            status: 200,
            headers: { "Content-Type": "application/fhir+json" },
          }
        );
      }
      return Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "error",
              code: "not-found",
              diagnostics: `No route found for ${req.method} ${url.pathname}`,
            },
          ],
        },
        {
          status: 404,
          headers: { "Content-Type": "application/fhir+json" },
        }
      );
    },
    error(err) {
      console.error("Server error:", err);
      return Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "error",
              code: "exception",
              diagnostics: err.message,
            },
          ],
        },
        {
          status: 500,
          headers: { "Content-Type": "application/fhir+json" },
        }
      );
    },
  });

  return { server, config, store, db };
}

function createDatabase(path?: string): Database {
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
  db.run("CREATE INDEX IF NOT EXISTS idx_resources_type_updated ON resources(resource_type, last_updated)");

  return db;
}
