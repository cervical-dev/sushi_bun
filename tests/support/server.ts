import { Database } from "bun:sqlite";
import { parseCapabilityStatement } from "../../src/fhir/capability.ts";
import { buildRoutes } from "../../src/router/generator.ts";
import { defaultHandlers } from "../../src/handlers/default.ts";
import { loadValidators } from "../../src/fhir/validator-loader.ts";
import { fallbackFetch } from "../../src/router/fallback.ts";
import { loadSearchParameters, applyResolvedMapping } from "../../src/fhir/search-param-loader.ts";
import { createSqliteStore } from "../../src/store/sqlite-provider.ts";
import type { RouteConfig } from "../../src/fhir/types.ts";
import type { ResourceStore } from "../../src/store/types.ts";

export interface TestServer {
  baseUrl: string;
  store: ResourceStore;
  stop: () => void;
}

export function createTestStore(): { store: ResourceStore; db: Database } {
  return createSqliteStore();
}

async function buildServer(
  capabilityJson: Record<string, unknown>,
  sdDir: string
): Promise<TestServer> {
  const config: RouteConfig = parseCapabilityStatement(capabilityJson as any);

  const [validators, searchParameters] = await Promise.all([
    loadValidators(sdDir),
    loadSearchParameters(sdDir),
  ]);

  applyResolvedMapping(config, searchParameters);

  const { store, db } = createSqliteStore();
  const handlers = await defaultHandlers(store, validators);
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
  const sdDir = capabilityPath.includes("/")
    ? capabilityPath.substring(0, capabilityPath.lastIndexOf("/"))
    : "fsh-generated/resources";
  return buildServer(capabilityJson, sdDir || "fsh-generated/resources");
}

export async function createTestServerWithCapability(
  capability: Record<string, unknown>,
  options?: { sdDir?: string }
): Promise<TestServer> {
  return buildServer(capability, options?.sdDir ?? "fsh-generated/resources");
}
