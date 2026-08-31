import type { ResourceConfig, RouteConfig, SearchParamConfig, OperationConfig } from "./types.ts";

interface CapabilityStatementJson {
  resourceType: "CapabilityStatement";
  rest?: Array<{
    mode: string;
    resource?: Array<{
      type: string;
      interaction?: Array<{ code: string }>;
      searchParam?: Array<{ name: string; type: string; documentation?: string }>;
      operation?: Array<{ name: string; definition: string }>;
      versioning?: string;
      readHistory?: boolean;
      updateCreate?: boolean;
      conditionalCreate?: boolean;
      conditionalRead?: string;
      conditionalUpdate?: boolean;
      conditionalDelete?: string;
    }>;
    interaction?: Array<{ code: string }>;
  }>;
}

export function parseCapabilityStatement(capability: CapabilityStatementJson): RouteConfig {
  const resources = new Map<string, ResourceConfig>();
  const systemInteractions = new Set<string>();

  const serverRest = capability.rest?.find((r) => r.mode === "server");
  if (!serverRest) {
    throw new Error("CapabilityStatement has no server rest entry");
  }

  if (serverRest.interaction) {
    for (const interaction of serverRest.interaction) {
      systemInteractions.add(interaction.code);
    }
  }

  if (serverRest.resource) {
    for (const resource of serverRest.resource) {
      const interactions = new Set<string>();
      if (resource.interaction) {
        for (const interaction of resource.interaction) {
          interactions.add(interaction.code);
        }
      }

      const searchParams = new Map<string, SearchParamConfig>();
      if (resource.searchParam) {
        for (const param of resource.searchParam) {
          searchParams.set(param.name, {
            name: param.name,
            type: param.type,
            documentation: param.documentation,
          });
        }
      }

      const operations: OperationConfig[] = [];
      if (resource.operation) {
        for (const op of resource.operation) {
          operations.push({ name: op.name, definition: op.definition });
        }
      }

      resources.set(resource.type, {
        type: resource.type,
        interactions,
        searchParams,
        operations,
        versioning: resource.versioning ?? "no-version",
        readHistory: resource.readHistory ?? false,
        updateCreate: resource.updateCreate ?? false,
        conditionalCreate: resource.conditionalCreate ?? false,
        conditionalRead: resource.conditionalRead ?? "not-supported",
        conditionalUpdate: resource.conditionalUpdate ?? false,
        conditionalDelete: resource.conditionalDelete ?? "not-supported",
      });
    }
  }

  return { resources, systemInteractions };
}
