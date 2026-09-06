import type { RouteConfig, ResourceConfig } from "../fhir/types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";

export type RouteHandler = (req: Request) => Response | Promise<Response>;

export interface HandlerProvider {
  handleCreate?: (req: Request, config: ResourceConfig) => Promise<Response>;
  handleRead?: (req: Request, config: ResourceConfig) => Response;
  handleUpdate?: (req: Request, config: ResourceConfig) => Promise<Response>;
  handleDelete?: (req: Request, config: ResourceConfig) => Response;
  handlePatch?: (req: Request, config: ResourceConfig) => Promise<Response>;
  handleSearch?: (req: Request, config: ResourceConfig) => Response;
  handlePostSearch?: (req: Request, config: ResourceConfig) => Promise<Response>;
  handleHistory?: (req: Request, config: ResourceConfig) => Response;
  handleTypeHistory?: (req: Request, config: ResourceConfig) => Response;
  handleSystemHistory?: (req: Request) => Response;
  handleBatch?: (req: Request, config: RouteConfig) => Promise<Response>;
  handleOperation?: (req: Request, operationName: string, config: ResourceConfig) => Response | Promise<Response>;
  handleSystemOperation?: (req: Request, operationName: string) => Response | Promise<Response>;
  handleMetadata?: (req: Request, capabilityJson: Record<string, unknown>) => Response;
  validators?: ValidatorRegistry;
}
