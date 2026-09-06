import { describe, it, expect, beforeEach } from "bun:test";
import { createTestStore } from "../helpers.ts";
import { buildRoutes } from "../../src/router/generator.ts";
import { sqliteProvider } from "../../src/store/sqlite-provider.ts";
import { defaultHandlers } from "../../src/handlers/default.ts";
import type { RouteConfig } from "../../src/fhir/types.ts";

describe("buildRoutes", () => {
  const provider = sqliteProvider();

  async function makeRoutes(config: RouteConfig) {
    const { store } = createTestStore();
    const handlers = await defaultHandlers(store, undefined, provider.translateFilters);
    return buildRoutes(config, {}, handlers);
  }

  it("generates metadata route", async () => {
    const config: RouteConfig = {
      resources: new Map(),
      systemInteractions: new Set(),
    };

    const routes = await makeRoutes(config);
    expect(routes["/metadata"]).toBeDefined();
  });

  it("generates type-level routes for supported interactions", async () => {
    const config: RouteConfig = {
      resources: new Map([
        [
          "Patient",
          {
            type: "Patient",
            interactions: new Set(["read", "search-type", "create", "update", "delete", "history-instance"]),
            searchParams: new Map(),
            operations: [],
            versioning: "versioned-update",
            readHistory: true,
            updateCreate: true,
            conditionalCreate: false,
            conditionalRead: "not-supported",
            conditionalUpdate: false,
            conditionalDelete: "not-supported",
          },
        ],
      ]),
      systemInteractions: new Set(),
    };

    const routes = await makeRoutes(config);

    expect(routes["/Patient"]).toBeDefined();
    expect(routes["/Patient/:id"]).toBeDefined();
    expect(routes["/Patient/:id/_history"]).toBeDefined();
    expect(routes["/Patient/:id/_history/:vid"]).toBeDefined();

    const typeHandlers = routes["/Patient"] as any;
    expect(typeHandlers.GET).toBeDefined();
    expect(typeHandlers.POST).toBeDefined();

    const instanceHandlers = routes["/Patient/:id"] as any;
    expect(instanceHandlers.GET).toBeDefined();
    expect(instanceHandlers.PUT).toBeDefined();
    expect(instanceHandlers.DELETE).toBeDefined();
  });

  it("only generates routes for interactions declared in capability", async () => {
    const config: RouteConfig = {
      resources: new Map([
        [
          "Observation",
          {
            type: "Observation",
            interactions: new Set(["read", "search-type"]),
            searchParams: new Map(),
            operations: [],
            versioning: "no-version",
            readHistory: false,
            updateCreate: false,
            conditionalCreate: false,
            conditionalRead: "not-supported",
            conditionalUpdate: false,
            conditionalDelete: "not-supported",
          },
        ],
      ]),
      systemInteractions: new Set(),
    };

    const routes = await makeRoutes(config);

    expect(routes["/Observation"]).toBeDefined();
    expect(routes["/Observation/:id"]).toBeDefined();
    expect(routes["/Observation/:id/_history"]).toBeUndefined();
    expect(routes["/Observation/:id/_history/:vid"]).toBeUndefined();
  });

  it("does not generate routes for unsupported resource types", async () => {
    const config: RouteConfig = {
      resources: new Map([
        [
          "Patient",
          {
            type: "Patient",
            interactions: new Set(["read"]),
            searchParams: new Map(),
            operations: [],
            versioning: "no-version",
            readHistory: false,
            updateCreate: false,
            conditionalCreate: false,
            conditionalRead: "not-supported",
            conditionalUpdate: false,
            conditionalDelete: "not-supported",
          },
        ],
      ]),
      systemInteractions: new Set(),
    };

    const routes = await makeRoutes(config);
    expect(routes["/Observation"]).toBeUndefined();
    expect(routes["/Observation/:id"]).toBeUndefined();
  });

  it("generates batch route when system interactions include batch", async () => {
    const config: RouteConfig = {
      resources: new Map(),
      systemInteractions: new Set(["batch", "transaction"]),
    };

    const routes = await makeRoutes(config);
    expect(routes["/"]).toBeDefined();
  });

  it("generates operation routes from capability", async () => {
    const config: RouteConfig = {
      resources: new Map([
        [
          "Patient",
          {
            type: "Patient",
            interactions: new Set(["read"]),
            searchParams: new Map(),
            operations: [{ name: "everything", definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything" }],
            versioning: "no-version",
            readHistory: false,
            updateCreate: false,
            conditionalCreate: false,
            conditionalRead: "not-supported",
            conditionalUpdate: false,
            conditionalDelete: "not-supported",
          },
        ],
      ]),
      systemInteractions: new Set(),
    };

    const routes = await makeRoutes(config);
    expect(routes["/Patient/$everything"]).toBeDefined();
    const opHandlers = routes["/Patient/$everything"] as any;
    expect(opHandlers.POST).toBeDefined();
  });
});

describe("defaultHandlers backward compatibility", () => {
  it("supports old 2-arg form (store, translateFilters) without crashing on search", async () => {
    const { store } = createTestStore();
    const provider = sqliteProvider();
    const handlers = await defaultHandlers(store, provider.translateFilters as any);
    expect(handlers).toBeDefined();
    expect(handlers.handleCreate).toBeDefined();
    const config = {
      type: "Patient",
      interactions: new Set(["search-type"]),
      searchParams: new Map(),
      operations: [],
      versioning: "no-version",
      readHistory: false,
      updateCreate: false,
      conditionalCreate: false,
      conditionalRead: "not-supported",
      conditionalUpdate: false,
      conditionalDelete: "not-supported",
    };
    const req = new Request("http://localhost/Patient?name=Smith", { method: "GET" });
    const res = await handlers.handleSearch(req, config);
    expect(res.status).not.toBe(500);
  });

  it("supports new 3-arg form (store, validators, translateFilters)", async () => {
    const { store } = createTestStore();
    const provider = sqliteProvider();
    const handlers = await defaultHandlers(store, undefined, provider.translateFilters);
    expect(handlers).toBeDefined();
    expect(handlers.handleCreate).toBeDefined();
  });

  it("supports string path form (dbPath, validators?)", async () => {
    const handlers = await defaultHandlers(":memory:");
    expect(handlers).toBeDefined();
    expect(handlers.handleCreate).toBeDefined();
  });
});
