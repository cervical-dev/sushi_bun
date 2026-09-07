import { parseCapabilityStatement } from "./fhir/capability.ts";
import { buildRoutes } from "./router/generator.ts";
import { defaultHandlers } from "./handlers/default.ts";
import { loadValidators } from "./fhir/validator-loader.ts";
import { fallbackFetch } from "./router/fallback.ts";
import { loadSearchParameters, applyResolvedMapping } from "./fhir/search-param-loader.ts";
import type { RouteConfig } from "./fhir/types.ts";
import type { HandlerProvider } from "./handlers/types.ts";

export interface ServerConfig {
  port?: number;
  capabilityPath: string;
  handlers?: HandlerProvider;
}

export async function createServer(serverConfig: ServerConfig) {
  const capabilityFile = Bun.file(serverConfig.capabilityPath);
  const capabilityJson = (await capabilityFile.json()) as Record<string, unknown>;
  const config: RouteConfig = parseCapabilityStatement(capabilityJson as any);

  const capabilityDir = serverConfig.capabilityPath.includes("/")
    ? serverConfig.capabilityPath.substring(0, serverConfig.capabilityPath.lastIndexOf("/"))
    : "fsh-generated/resources";
  const sdDir = capabilityDir || "fsh-generated/resources";

  const [validators, searchParameters] = await Promise.all([
    loadValidators(sdDir),
    loadSearchParameters(sdDir),
  ]);

  applyResolvedMapping(config, searchParameters);

  const handlers = serverConfig.handlers ?? await defaultHandlers(undefined, validators);
  const routes = buildRoutes(config, capabilityJson, handlers);

  const server = Bun.serve({
    port: serverConfig.port ?? 3000,
    routes,
    fetch: fallbackFetch,
    error(err) {
      console.error("Server error:", err);
      return Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "error",
              code: "exception",
              diagnostics: "An internal server error occurred",
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

  return { server, config };
}
