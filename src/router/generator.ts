import type { RouteConfig } from "../fhir/types.ts";
import type { RouteHandler, HandlerProvider } from "../handlers/types.ts";
import { handleMetadata } from "../handlers/metadata.ts";
import { isAcceptable, addStandardHeaders } from "./middleware.ts";

interface MethodHandlers {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
}

type GeneratedRoutes = Record<string, MethodHandlers | RouteHandler>;

function wrapWithAcceptCheck(handler: RouteHandler): RouteHandler {
  return (req) => {
    if (!isAcceptable(req.headers.get("Accept"))) {
      const res = Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [{ severity: "error", code: "not-acceptable", diagnostics: "Accept header must include application/fhir+json or application/json" }],
        },
        { status: 406, headers: { "Content-Type": "application/fhir+json" } }
      );
      return addStandardHeaders(res);
    }
    const result = handler(req);
    if (result instanceof Response) {
      return addStandardHeaders(result);
    }
    return result.then((r) => addStandardHeaders(r));
  };
}

export function buildRoutes(
  config: RouteConfig,
  capabilityJson: Record<string, unknown>,
  handlers: HandlerProvider
): GeneratedRoutes {
  const routes: GeneratedRoutes = {};

  routes["/metadata"] = wrapWithAcceptCheck((req) => (handlers.handleMetadata ?? handleMetadata)(req, capabilityJson));

  routes["/"] = {
    GET: wrapWithAcceptCheck((_req) => {
      return Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [{ severity: "information", code: "informational", diagnostics: "This is a FHIR R5 server. Use /metadata to discover capabilities." }],
        },
        { status: 200, headers: { "Content-Type": "application/fhir+json" } }
      );
    }),
    POST: wrapWithAcceptCheck((req) => handlers.handleBatch!(req, config)),
  };

  for (const [resourceType, resourceConfig] of config.resources) {
    const typeHandlers: MethodHandlers = {};

    if (resourceConfig.interactions.has("search-type")) {
      typeHandlers.GET = wrapWithAcceptCheck((req) => handlers.handleSearch!(req, resourceConfig));
    }

    if (resourceConfig.interactions.has("create")) {
      typeHandlers.POST = wrapWithAcceptCheck((req) => handlers.handleCreate!(req, resourceConfig));
    }

    if (Object.keys(typeHandlers).length > 0) {
      routes[`/${resourceType}`] = typeHandlers;
    }

    const instanceHandlers: MethodHandlers = {};

    if (resourceConfig.interactions.has("read")) {
      instanceHandlers.GET = wrapWithAcceptCheck((req) => handlers.handleRead!(req, resourceConfig));
    }

    if (resourceConfig.interactions.has("update")) {
      instanceHandlers.PUT = wrapWithAcceptCheck((req) => handlers.handleUpdate!(req, resourceConfig));
    }

    if (resourceConfig.interactions.has("delete")) {
      instanceHandlers.DELETE = wrapWithAcceptCheck((req) => handlers.handleDelete!(req, resourceConfig));
    }

    if (resourceConfig.interactions.has("patch")) {
      instanceHandlers.PATCH = wrapWithAcceptCheck((req) => handlers.handlePatch!(req, resourceConfig));
    }

    if (Object.keys(instanceHandlers).length > 0) {
      routes[`/${resourceType}/:id`] = instanceHandlers;
    }

    if (resourceConfig.interactions.has("history-instance")) {
      routes[`/${resourceType}/:id/_history/:vid`] = {
        GET: wrapWithAcceptCheck((req) => handlers.handleRead!(req, resourceConfig)),
      };
    }

    if (resourceConfig.interactions.has("history-instance")) {
      routes[`/${resourceType}/:id/_history`] = {
        GET: wrapWithAcceptCheck((req) => handlers.handleHistory!(req, resourceConfig)),
      };
    }

    if (resourceConfig.interactions.has("history-type")) {
      routes[`/${resourceType}/_history`] = {
        GET: wrapWithAcceptCheck((req) => handlers.handleTypeHistory!(req, resourceConfig)),
      };
    }

    if (resourceConfig.interactions.has("search-type")) {
      routes[`/${resourceType}/_search`] = {
        POST: wrapWithAcceptCheck((req) => handlers.handlePostSearch!(req, resourceConfig)),
      };
    }

    for (const op of resourceConfig.operations) {
      routes[`/${resourceType}/$${op.name}`] = {
        POST: wrapWithAcceptCheck((req) => handlers.handleOperation!(req, op.name, resourceConfig)),
      };

      routes[`/${resourceType}/:id/$${op.name}`] = {
        POST: wrapWithAcceptCheck((req) => handlers.handleOperation!(req, op.name, resourceConfig)),
      };
    }
  }

  if (config.systemInteractions.has("history-system")) {
    routes["/_history"] = {
      GET: wrapWithAcceptCheck((req) => handlers.handleSystemHistory!(req)),
    };
  }

  for (const op of config.systemOperations ?? []) {
    routes[`/$${op.name}`] = {
      POST: wrapWithAcceptCheck((req) => handlers.handleSystemOperation!(req, op.name)),
    };
  }

  return routes;
}
