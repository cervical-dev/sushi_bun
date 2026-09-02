import type { RouteConfig, ResourceConfig } from "../fhir/types.ts";

export type RouteHandler = (req: Request) => Response | Promise<Response>;

export interface HandlerProvider {
  handleCreate?: (req: Request, config: ResourceConfig) => Promise<Response>;
  handleRead?: (req: Request, config: ResourceConfig) => Response;
  handleUpdate?: (req: Request, config: ResourceConfig) => Promise<Response>;
  handleDelete?: (req: Request, config: ResourceConfig) => Response;
  handleSearch?: (req: Request, config: ResourceConfig) => Response;
  handleHistory?: (req: Request, config: ResourceConfig) => Response;
  handleBatch?: (req: Request, config: RouteConfig) => Promise<Response>;
  handleOperation?: (req: Request, operationName: string, config: ResourceConfig) => Response;
  handleMetadata?: (req: Request, capabilityJson: Record<string, unknown>) => Response;
}
