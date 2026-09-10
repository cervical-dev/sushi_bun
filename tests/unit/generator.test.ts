import { describe, it, expect, beforeEach } from "bun:test";
import { createTestStore } from "../support/index.ts";
import { buildRoutes, validateHandlerKeys } from "../../src/router/generator.ts";
import { defaultHandlers } from "../../src/handlers/default.ts";
import type { RouteConfig } from "../../src/fhir/types.ts";

describe("buildRoutes", () => {
  async function makeRoutes(config: RouteConfig) {
    const { store } = createTestStore();
    const handlers = await defaultHandlers(store);
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
            updateCreate: true,
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
            updateCreate: false,
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
            updateCreate: false,
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

  it("does not generate POST / route when batch and transaction are not declared", async () => {
    const config: RouteConfig = {
      resources: new Map(),
      systemInteractions: new Set(["history-system"]),
    };

    const routes = await makeRoutes(config);
    const rootRoute = routes["/"] as any;
    expect(rootRoute).toBeDefined();
    expect(rootRoute.POST).toBeUndefined();
    expect(rootRoute.GET).toBeDefined();
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
            updateCreate: false,
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

describe("handler validation", () => {
  const patientConfig: RouteConfig = {
    resources: new Map([
      [
        "Patient",
        {
          type: "Patient",
          interactions: new Set(["read", "search-type", "create", "update", "delete", "patch", "history-instance"]),
          searchParams: new Map(),
          operations: [{ name: "everything", definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything" }],
            updateCreate: true,
        },
      ],
    ]),
    systemInteractions: new Set(["batch", "transaction", "history-system"]),
  };

  function makeHandler(overrides: Record<string, any>) {
    const base: Record<string, any> = {};
    return base as any;
  }

  it("throws when a declared interaction is missing its handler", async () => {
    const handlers = makeHandler({});
    expect(() => buildRoutes(patientConfig, {}, handlers)).toThrow(/handleRead/i);
  });

  it("throws when search-type is declared but handleSearch is missing", async () => {
    const handlers = {
      handleRead: () => new Response(),
    } as any;
    expect(() => buildRoutes(patientConfig, {}, handlers)).toThrow(/handleSearch/i);
  });

  it("throws when search-type is declared but handlePostSearch is missing", async () => {
    const handlers = {
      handleRead: () => new Response(),
      handleSearch: () => new Response(),
    } as any;
    expect(() => buildRoutes(patientConfig, {}, handlers)).toThrow(/handlePostSearch/i);
  });

  it("throws when history-instance is declared but handleRead is missing (vread route)", async () => {
    const config: RouteConfig = {
      resources: new Map([
        [
          "Patient",
          {
            type: "Patient",
            interactions: new Set(["read", "history-instance"]),
            searchParams: new Map(),
            operations: [],
            updateCreate: true,
          },
        ],
      ]),
      systemInteractions: new Set(),
    };
    const handlers = makeHandler({});
    expect(() => buildRoutes(config, {}, handlers)).toThrow(/handleRead/);
  });

  it("throws when batch is declared but handleBatch is missing", async () => {
    const handlers = makeHandler({});
    expect(() => buildRoutes(patientConfig, {}, handlers)).toThrow(/handleBatch/i);
  });

  it("throws when history-system is declared but handleSystemHistory is missing", async () => {
    const handlers = makeHandler({});
    expect(() => buildRoutes(patientConfig, {}, handlers)).toThrow(/handleSystemHistory/i);
  });

  it("throws when an operation is declared but handleOperation is missing", async () => {
    const handlers = makeHandler({});
    expect(() => buildRoutes(patientConfig, {}, handlers)).toThrow(/handleOperation/i);
  });

  it("does not throw when all required handlers are provided", async () => {
    const handlers = {
      handleRead: () => new Response(),
      handleSearch: () => new Response(),
      handlePostSearch: () => new Response(),
      handleCreate: () => new Response(),
      handleUpdate: () => new Response(),
      handleDelete: () => new Response(),
      handlePatch: () => new Response(),
      handleHistory: () => new Response(),
      handleTypeHistory: () => new Response(),
      handleSystemHistory: () => new Response(),
      handleBatch: () => new Response(),
      handleOperation: () => new Response(),
      handleSystemOperation: () => new Response(),
      handleMetadata: () => new Response(),
    } as any;
    expect(() => buildRoutes(patientConfig, {}, handlers)).not.toThrow();
  });
});

describe("validateHandlerKeys", () => {
  const readOnlyConfig: RouteConfig = {
    resources: new Map([
      [
        "Patient",
          {
          type: "Patient",
          interactions: new Set(["read"]),
          searchParams: new Map(),
          operations: [],
          updateCreate: false,
        },
      ],
    ]),
    systemInteractions: new Set(),
  };

  it("does not throw when provided handlers exactly match required", async () => {
    const handlers = { handleRead: () => new Response() } as any;
    expect(() => validateHandlerKeys(readOnlyConfig, handlers)).not.toThrow();
  });

  it("does not throw when handleMetadata is provided (always used)", async () => {
    const handlers = {
      handleRead: () => new Response(),
      handleMetadata: () => new Response(),
    } as any;
    expect(() => validateHandlerKeys(readOnlyConfig, handlers)).not.toThrow();
  });

  it("throws when handlePatch is provided but config has no patch interaction", async () => {
    const handlers = {
      handleRead: () => new Response(),
      handlePatch: () => new Response(),
    } as any;
    expect(() => validateHandlerKeys(readOnlyConfig, handlers)).toThrow(/handlePatch/i);
  });

  it("throws listing all surplus handlers", async () => {
    const handlers = {
      handleRead: () => new Response(),
      handlePatch: () => new Response(),
      handleDelete: () => new Response(),
      handleBatch: () => new Response(),
    } as any;
    expect(() => validateHandlerKeys(readOnlyConfig, handlers)).toThrow(/handlePatch.*handleDelete.*handleBatch|handleBatch.*handleDelete.*handlePatch/);
  });
});

describe("defaultHandlers", () => {
  it("supports store + validators form", async () => {
    const { store } = createTestStore();
    const handlers = await defaultHandlers(store);
    expect(handlers).toBeDefined();
    expect(handlers.handleCreate).toBeDefined();
  });

  it("supports string path form (dbPath, validators?)", async () => {
    const handlers = await defaultHandlers(":memory:");
    expect(handlers).toBeDefined();
    expect(handlers.handleCreate).toBeDefined();
  });
});
