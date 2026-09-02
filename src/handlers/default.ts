import type { ResourceStore, FilterTranslator } from "../store/types.ts";
import type { HandlerProvider } from "./types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { sqliteProvider } from "../store/sqlite-provider.ts";
import { handleMetadata } from "./metadata.ts";
import { handleRead } from "./read.ts";
import { handleCreate } from "./create.ts";
import { handleUpdate } from "./update.ts";
import { handleDelete } from "./delete.ts";
import { handleSearch } from "./search.ts";
import { handleHistory } from "./history.ts";
import { handleBatch } from "./batch.ts";
import { handleOperation } from "./operations.ts";

export function defaultHandlers(dbPath?: string, validators?: ValidatorRegistry): Promise<HandlerProvider>;
export function defaultHandlers(store: ResourceStore, validators?: ValidatorRegistry, translateFilters?: FilterTranslator): Promise<HandlerProvider>;
export async function defaultHandlers(
  dbPathOrStore?: string | ResourceStore,
  validators?: ValidatorRegistry,
  translateFilters?: FilterTranslator
): Promise<HandlerProvider> {
  let store: ResourceStore;
  let filters: FilterTranslator;

  if (typeof dbPathOrStore === "string" || dbPathOrStore === undefined) {
    const provider = sqliteProvider(dbPathOrStore);
    const result = provider.createStore();
    store = result instanceof Promise ? await result : result;
    filters = provider.translateFilters;
  } else {
    store = dbPathOrStore;
    filters = translateFilters!;
  }

  return {
    handleMetadata,
    handleRead: (req, config) => handleRead(req, config, store),
    handleCreate: (req, config) => handleCreate(req, config, store, validators),
    handleUpdate: (req, config) => handleUpdate(req, config, store, validators),
    handleDelete: (req, config) => handleDelete(req, config, store),
    handleSearch: (req, config) => handleSearch(req, config, store, filters),
    handleHistory: (req, config) => handleHistory(req, config, store),
    handleBatch: (req, config) => handleBatch(req, config, store, validators),
    handleOperation: (req, operationName, config) => handleOperation(req, operationName, config, store, validators),
    validators,
  };
}
