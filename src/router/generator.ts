import type { RouteConfig } from "../fhir/types.ts";
import type { RouteHandler, HandlerProvider } from "../handlers/types.ts";
import { handleMetadata } from "../handlers/metadata.ts";

interface MethodHandlers {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
}

type GeneratedRoutes = Record<string, MethodHandlers | RouteHandler>;

export function buildRoutes(
  config: RouteConfig,
  capabilityJson: Record<string, unknown>,
  handlers: HandlerProvider
): GeneratedRoutes {
  const routes: GeneratedRoutes = {};

  routes["/metadata"] = (req) => (handlers.handleMetadata ?? handleMetadata)(req, capabilityJson);

  routes["/"] = {
    GET: (_req) => {
      return Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [{ severity: "information", code: "informational", diagnostics: "This is a FHIR R5 server. Use /metadata to discover capabilities." }],
        },
        { status: 200, headers: { "Content-Type": "application/fhir+json" } }
      );
    },
    POST: (req) => handlers.handleBatch!(req, config),
  };

  for (const [resourceType, resourceConfig] of config.resources) {
    const typeHandlers: MethodHandlers = {};

    if (resourceConfig.interactions.has("search-type")) {
      typeHandlers.GET = (req) => handlers.handleSearch!(req, resourceConfig);
    }

    if (resourceConfig.interactions.has("create")) {
      typeHandlers.POST = (req) => handlers.handleCreate!(req, resourceConfig);
    }

    if (Object.keys(typeHandlers).length > 0) {
      routes[`/${resourceType}`] = typeHandlers;
    }

    const instanceHandlers: MethodHandlers = {};

    if (resourceConfig.interactions.has("read")) {
      instanceHandlers.GET = (req) => handlers.handleRead!(req, resourceConfig);
    }

    if (resourceConfig.interactions.has("update")) {
      instanceHandlers.PUT = (req) => handlers.handleUpdate!(req, resourceConfig);
    }

    if (resourceConfig.interactions.has("delete")) {
      instanceHandlers.DELETE = (req) => handlers.handleDelete!(req, resourceConfig);
    }

    if (Object.keys(instanceHandlers).length > 0) {
      routes[`/${resourceType}/:id`] = instanceHandlers;
    }

    if (resourceConfig.interactions.has("history-instance")) {
      routes[`/${resourceType}/:id/_history/:vid`] = {
        GET: (req) => handlers.handleRead!(req, resourceConfig),
      };
    }

    if (resourceConfig.interactions.has("history-instance")) {
      routes[`/${resourceType}/:id/_history`] = {
        GET: (req) => handlers.handleHistory!(req, resourceConfig),
      };
    }

    for (const op of resourceConfig.operations) {
      routes[`/${resourceType}/$${op.name}`] = {
        POST: (req) => handlers.handleOperation!(req, op.name, resourceConfig),
      };
    }
  }

  return routes;
}
