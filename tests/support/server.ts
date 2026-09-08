import { Database } from "bun:sqlite";
import { createDatabase } from "../../src/db.ts";
import { parseCapabilityStatement } from "../../src/fhir/capability.ts";
import { buildRoutes } from "../../src/router/generator.ts";
import { defaultHandlers } from "../../src/handlers/default.ts";
import { loadValidators } from "../../src/fhir/validator-loader.ts";
import { fallbackFetch } from "../../src/router/fallback.ts";
import { loadSearchParameters, applyResolvedMapping } from "../../src/fhir/search-param-loader.ts";
import { createResourceStore } from "../../src/store/resource-store.ts";
import { sqliteProvider } from "../../src/store/sqlite-provider.ts";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { RouteConfig } from "../../src/fhir/types.ts";
import type { ResourceStore } from "../../src/store/types.ts";

export interface TestServer {
  baseUrl: string;
  store: ResourceStore;
  stop: () => void;
}

export function createTestStore(): { store: ResourceStore; db: Database } {
  const db = createDatabase();
  return { store: createResourceStore(db), db };
}

async function buildServer(
  capabilityJson: Record<string, unknown>,
  capabilityPath: string,
  sdDir?: string
): Promise<TestServer> {
  const config: RouteConfig = parseCapabilityStatement(capabilityJson as any);

  const resolvedSdDir = sdDir ??
    ((capabilityPath.includes("/")
      ? capabilityPath.substring(0, capabilityPath.lastIndexOf("/"))
      : "fsh-generated/resources") || "fsh-generated/resources");

  const [validators, searchParameters] = await Promise.all([
    loadValidators(resolvedSdDir),
    loadSearchParameters(resolvedSdDir),
  ]);

  applyResolvedMapping(config, searchParameters);

  const db = createDatabase();
  const store = createResourceStore(db);
  const provider = sqliteProvider();
  const handlers = await defaultHandlers(store, validators, provider.translateFilters);
  const routes = buildRoutes(config, capabilityJson, handlers);

  const server = Bun.serve({
    port: 0,
    routes,
    fetch: fallbackFetch,
  });

  return {
    baseUrl: server.url.toString(),
    store,
    stop: () => {
      server.stop();
      db.close();
    },
  };
}

export async function createTestServer(
  capabilityPath: string
): Promise<TestServer> {
  const capabilityFile = Bun.file(capabilityPath);
  const capabilityJson = (await capabilityFile.json()) as Record<string, unknown>;
  return buildServer(capabilityJson, capabilityPath);
}

export async function createTestServerWithCapability(
  capability: Record<string, unknown>,
  options?: { sdDir?: string }
): Promise<TestServer> {
  const tmpFile = join(tmpdir(), `capability-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(capability));
  try {
    return await buildServer(capability, tmpFile, options?.sdDir);
  } catch (err) {
    try { unlinkSync(tmpFile); } catch {}
    throw err;
  }
}
