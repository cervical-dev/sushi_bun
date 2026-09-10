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

function computeRequiredHandlerKeys(config: RouteConfig): Set<keyof HandlerProvider> {
  const required = new Set<keyof HandlerProvider>();

  for (const [, rc] of config.resources) {
    if (rc.interactions.has("search-type")) {
      required.add("handleSearch");
      required.add("handlePostSearch");
    }
    if (rc.interactions.has("create")) required.add("handleCreate");
    if (rc.interactions.has("read")) required.add("handleRead");
    if (rc.interactions.has("update")) required.add("handleUpdate");
    if (rc.interactions.has("delete")) required.add("handleDelete");
    if (rc.interactions.has("patch")) required.add("handlePatch");
    if (rc.interactions.has("history-instance")) {
      required.add("handleRead");
      required.add("handleHistory");
    }
    if (rc.interactions.has("history-type")) required.add("handleTypeHistory");
    for (const _op of rc.operations) {
      required.add("handleOperation");
    }
  }

  if (config.systemInteractions.has("batch") || config.systemInteractions.has("transaction")) {
    required.add("handleBatch");
  }
  if (config.systemInteractions.has("history-system")) {
    required.add("handleSystemHistory");
  }
  for (const _op of config.systemOperations ?? []) {
    required.add("handleSystemOperation");
  }

  return required;
}

export function validateHandlerKeys(config: RouteConfig, handlers: HandlerProvider): void {
  const required = computeRequiredHandlerKeys(config);

  const providedKeys = Object.keys(handlers).filter(
    (k) => k !== "validators" && k !== "handleMetadata" && typeof (handlers as any)[k] === "function"
  ) as Array<keyof HandlerProvider>;

  const surplus = providedKeys.filter((k) => !required.has(k));
  if (surplus.length > 0) {
    throw new Error(
      `Surplus handlers not needed by the CapabilityStatement: ${surplus.join(", ")}`
    );
  }
}

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

  const required = computeRequiredHandlerKeys(config);

  const missing = [...required].filter((key) => typeof handlers[key] !== "function");
  if (missing.length > 0) {
    throw new Error(`Missing required handlers: ${missing.join(", ")}`);
  }

  routes["/metadata"] = wrapWithAcceptCheck((req) => (handlers.handleMetadata ?? handleMetadata)(req, capabilityJson));

  const rootRoute: MethodHandlers = {
    GET: wrapWithAcceptCheck((_req) => {
      return Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [{ severity: "information", code: "informational", diagnostics: "This is a FHIR R5 server. Use /metadata to discover capabilities." }],
        },
        { status: 200, headers: { "Content-Type": "application/fhir+json" } }
      );
    }),
  };

  if (config.systemInteractions.has("batch") || config.systemInteractions.has("transaction")) {
    rootRoute.POST = wrapWithAcceptCheck((req) => handlers.handleBatch!(req, config));
  }

  routes["/"] = rootRoute;

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
