import type { RouteConfig } from "../fhir/types.ts";
import type { ResourceStore } from "../store/resource-store.ts";
import { handleMetadata } from "../handlers/metadata.ts";
import { handleRead } from "../handlers/read.ts";
import { handleCreate } from "../handlers/create.ts";
import { handleUpdate } from "../handlers/update.ts";
import { handleDelete } from "../handlers/delete.ts";
import { handleSearch } from "../handlers/search.ts";
import { handleHistory } from "../handlers/history.ts";
import { handleBatch } from "../handlers/batch.ts";
import { handleOperation } from "../handlers/operations.ts";

type RouteHandler = (req: Request) => Response | Promise<Response>;

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
  store: ResourceStore,
  capabilityJson: Record<string, unknown>
): GeneratedRoutes {
  const routes: GeneratedRoutes = {};

  routes["/metadata"] = (req) => handleMetadata(req, capabilityJson);

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
    POST: (req) => handleBatch(req, config, store),
  };

  for (const [resourceType, resourceConfig] of config.resources) {
    const typeHandlers: MethodHandlers = {};

    if (resourceConfig.interactions.has("search-type")) {
      typeHandlers.GET = (req) => handleSearch(req, resourceConfig, store);
    }

    if (resourceConfig.interactions.has("create")) {
      typeHandlers.POST = (req) => handleCreate(req, resourceConfig, store);
    }

    if (Object.keys(typeHandlers).length > 0) {
      routes[`/${resourceType}`] = typeHandlers;
    }

    const instanceHandlers: MethodHandlers = {};

    if (resourceConfig.interactions.has("read")) {
      instanceHandlers.GET = (req) => handleRead(req, resourceConfig, store);
    }

    if (resourceConfig.interactions.has("update")) {
      instanceHandlers.PUT = (req) => handleUpdate(req, resourceConfig, store);
    }

    if (resourceConfig.interactions.has("delete")) {
      instanceHandlers.DELETE = (req) => handleDelete(req, resourceConfig, store);
    }

    if (Object.keys(instanceHandlers).length > 0) {
      routes[`/${resourceType}/:id`] = instanceHandlers;
    }

    if (resourceConfig.interactions.has("history-instance") || resourceConfig.interactions.has("read")) {
      routes[`/${resourceType}/:id/_history/:vid`] = {
        GET: (req) => handleRead(req, resourceConfig, store),
      };
    }

    if (resourceConfig.interactions.has("history-instance")) {
      routes[`/${resourceType}/:id/_history`] = {
        GET: (req) => handleHistory(req, resourceConfig, store),
      };
    }

    for (const op of resourceConfig.operations) {
      routes[`/${resourceType}/$${op.name}`] = {
        POST: (req) => handleOperation(req, op.name, resourceConfig, store),
      };
    }
  }

  return routes;
}
