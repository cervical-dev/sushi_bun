import type { ResourceStore } from "../store/types.ts";
import type { HandlerProvider } from "./types.ts";
import type { ValidatorRegistry } from "../fhir/validator-loader.ts";
import { sqliteProvider } from "../store/sqlite-provider.ts";
import { handleMetadata } from "./metadata.ts";
import { handleRead } from "./read.ts";
import { handleCreate } from "./create.ts";
import { handleUpdate } from "./update.ts";
import { handleDelete } from "./delete.ts";
import { handleSearch, handlePostSearch } from "./search.ts";
import { handleHistory, handleTypeHistory, handleSystemHistory } from "./history.ts";
import { handlePatch } from "./patch.ts";
import { handleBatch } from "./batch.ts";
import { handleOperation, handleSystemOperation } from "./operations.ts";

export async function defaultHandlers(dbPath?: string, validators?: ValidatorRegistry): Promise<HandlerProvider>;
export async function defaultHandlers(store: ResourceStore, validators?: ValidatorRegistry): Promise<HandlerProvider>;
export async function defaultHandlers(
  dbPathOrStore?: string | ResourceStore,
  validators?: ValidatorRegistry
): Promise<HandlerProvider> {
  let store: ResourceStore;

  if (typeof dbPathOrStore === "string" || dbPathOrStore === undefined) {
    const provider = sqliteProvider(dbPathOrStore);
    const result = provider.createStore();
    store = result instanceof Promise ? await result : result;
  } else {
    store = dbPathOrStore;
  }

  return {
    handleMetadata,
    handleRead: (req, config) => handleRead(req, config, store),
    handleCreate: (req, config) => handleCreate(req, config, store, validators),
    handleUpdate: (req, config) => handleUpdate(req, config, store, validators),
    handleDelete: (req, config) => handleDelete(req, config, store),
    handlePatch: (req, config) => handlePatch(req, config, store, validators),
    handleSearch: (req, config) => handleSearch(req, config, store),
    handlePostSearch: (req, config) => handlePostSearch(req, config, store),
    handleHistory: (req, config) => handleHistory(req, config, store),
    handleTypeHistory: (req, config) => handleTypeHistory(req, config, store),
    handleSystemHistory: (req) => handleSystemHistory(req, store),
    handleBatch: (req, config) => handleBatch(req, config, store, validators),
    handleOperation: (req, operationName, config) => handleOperation(req, operationName, config, store, validators),
    handleSystemOperation: (req, operationName) => handleSystemOperation(req, operationName),
    validators,
  };
}
