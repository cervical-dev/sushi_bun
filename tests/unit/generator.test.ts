import { describe, it, expect, beforeEach } from "bun:test";
import { createTestStore } from "../helpers.ts";
import { buildRoutes } from "../../src/router/generator.ts";
import type { RouteConfig } from "../../src/fhir/types.ts";

describe("buildRoutes", () => {
  let store: ReturnType<typeof createTestStore>["store"];

  beforeEach(() => {
    store = createTestStore().store;
  });

  it("generates metadata route", () => {
    const config: RouteConfig = {
      resources: new Map(),
      systemInteractions: new Set(),
    };

    const routes = buildRoutes(config, store, {});
    expect(routes["/metadata"]).toBeDefined();
  });

  it("generates type-level routes for supported interactions", () => {
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

    const routes = buildRoutes(config, store, {});

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

  it("only generates routes for interactions declared in capability", () => {
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

    const routes = buildRoutes(config, store, {});

    expect(routes["/Observation"]).toBeDefined();
    expect(routes["/Observation/:id"]).toBeDefined();
    expect(routes["/Observation/:id/_history"]).toBeUndefined();
  });

  it("does not generate routes for unsupported resource types", () => {
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

    const routes = buildRoutes(config, store, {});
    expect(routes["/Observation"]).toBeUndefined();
    expect(routes["/Observation/:id"]).toBeUndefined();
  });

  it("generates batch route when system interactions include batch", () => {
    const config: RouteConfig = {
      resources: new Map(),
      systemInteractions: new Set(["batch", "transaction"]),
    };

    const routes = buildRoutes(config, store, {});
    expect(routes["/"]).toBeDefined();
  });

  it("generates operation routes from capability", () => {
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

    const routes = buildRoutes(config, store, {});
    expect(routes["/Patient/$everything"]).toBeDefined();
    const opHandlers = routes["/Patient/$everything"] as any;
    expect(opHandlers.POST).toBeDefined();
  });
});
