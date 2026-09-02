import { parseCapabilityStatement } from "./fhir/capability.ts";
import { buildRoutes } from "./router/generator.ts";
import { defaultHandlers } from "./handlers/default.ts";
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

  const handlers = serverConfig.handlers ?? await defaultHandlers();
  const routes = buildRoutes(config, capabilityJson, handlers);

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
              diagnostics: `No route found for ${req.method}`,
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
