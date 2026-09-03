import { describe, it, expect } from "bun:test";
import { resolveStructureDefinition, buildElementIndex } from "../../src/fhir/schema/type-resolver.ts";
import type { StructureDefinition, StructureDefinitionElement } from "../../src/fhir/types.ts";

describe("resolveStructureDefinition", () => {
  const basePatientSD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "Patient",
    url: "http://hl7.org/fhir/StructureDefinition/Patient",
    type: "Patient",
    snapshot: {
      element: [
        { id: "Patient", path: "Patient" },
        { id: "Patient.id", path: "Patient.id", type: [{ code: "id" }], min: 0, max: "1" },
        { id: "Patient.meta", path: "Patient.meta", type: [{ code: "Meta" }], min: 0, max: "1" },
        { id: "Patient.identifier", path: "Patient.identifier", type: [{ code: "Identifier" }], min: 0, max: "*" },
        { id: "Patient.name", path: "Patient.name", type: [{ code: "HumanName" }], min: 0, max: "*" },
        { id: "Patient.gender", path: "Patient.gender", type: [{ code: "code" }], min: 0, max: "1" },
        { id: "Patient.birthDate", path: "Patient.birthDate", type: [{ code: "date" }], min: 0, max: "1" },
      ],
    },
  };

  it("returns SD unchanged when no baseDefinition", () => {
    const result = resolveStructureDefinition(basePatientSD);
    expect(result).toBe(basePatientSD);
  });

  it("merges snapshot elements with differential overrides", () => {
    const profileSD: StructureDefinition = {
      resourceType: "StructureDefinition",
      id: "my-patient",
      url: "http://example.org/fhir/StructureDefinition/my-patient",
      type: "Patient",
      baseDefinition: "http://hl7.org/fhir/StructureDefinition/Patient",
      differential: {
        element: [
          { id: "Patient.identifier", path: "Patient.identifier", min: 1, max: "*", mustSupport: true },
          { id: "Patient.name", path: "Patient.name", min: 1, max: "*", mustSupport: true },
          { id: "Patient.gender", path: "Patient.gender", min: 1, mustSupport: true },
          { id: "Patient.birthDate", path: "Patient.birthDate", min: 1, mustSupport: true },
        ],
      },
    };

    const registry = new Map<string, StructureDefinition>();
    registry.set(basePatientSD.url, basePatientSD);

    const resolved = resolveStructureDefinition(profileSD, registry);
    expect(resolved.differential?.element).toBeDefined();

    const elements = resolved.differential!.element;
    const idElement = elements.find(e => e.id === "Patient.id");
    expect(idElement).toBeDefined();
    expect(idElement!.type).toEqual([{ code: "id" }]);
    expect(idElement!.min).toBe(0);

    const identifierElement = elements.find(e => e.id === "Patient.identifier");
    expect(identifierElement).toBeDefined();
    expect(identifierElement!.min).toBe(1);
    expect(identifierElement!.mustSupport).toBe(true);
  });

  it("uses snapshot from base when available", () => {
    const profileSD: StructureDefinition = {
      resourceType: "StructureDefinition",
      id: "my-patient",
      url: "http://example.org/fhir/StructureDefinition/my-patient",
      type: "Patient",
      baseDefinition: "http://hl7.org/fhir/StructureDefinition/Patient",
      differential: {
        element: [
          { id: "Patient.gender", path: "Patient.gender", min: 1 },
        ],
      },
    };

    const registry = new Map<string, StructureDefinition>();
    registry.set(basePatientSD.url, basePatientSD);

    const resolved = resolveStructureDefinition(profileSD, registry);
    const elements = resolved.differential!.element;

    expect(elements.length).toBeGreaterThanOrEqual(5);

    const genderElement = elements.find(e => e.id === "Patient.gender");
    expect(genderElement!.min).toBe(1);
    expect(genderElement!.type).toEqual([{ code: "code" }]);
  });

  it("handles missing baseDefinition SD gracefully", () => {
    const profileSD: StructureDefinition = {
      resourceType: "StructureDefinition",
      id: "orphan",
      url: "http://example.org/fhir/StructureDefinition/orphan",
      type: "Patient",
      baseDefinition: "http://unknown.org/SD",
      differential: {
        element: [
          { id: "Patient.gender", path: "Patient.gender", min: 1 },
        ],
      },
    };

    const registry = new Map<string, StructureDefinition>();
    const resolved = resolveStructureDefinition(profileSD, registry);
    expect(resolved.differential!.element).toHaveLength(1);
  });

  it("returns SD as-is when no differential", () => {
    const sd: StructureDefinition = {
      resourceType: "StructureDefinition",
      id: "no-diff",
      url: "http://example.org/no-diff",
      type: "Patient",
    };
    const result = resolveStructureDefinition(sd);
    expect(result).toBe(sd);
  });
});

describe("buildElementIndex", () => {
  it("indexes elements by their path", () => {
    const elements: StructureDefinitionElement[] = [
      { id: "Patient", path: "Patient" },
      { id: "Patient.identifier", path: "Patient.identifier" },
      { id: "Patient.name", path: "Patient.name" },
      { id: "Patient.name.family", path: "Patient.name.family" },
    ];

    const index = buildElementIndex(elements);
    expect(index.has("Patient.identifier")).toBe(true);
    expect(index.has("Patient.name")).toBe(true);
    expect(index.has("Patient.name.family")).toBe(true);
  });

  it("maps each path to its element", () => {
    const elements: StructureDefinitionElement[] = [
      { id: "Patient.gender", path: "Patient.gender", min: 1 },
    ];
    const index = buildElementIndex(elements);
    expect(index.get("Patient.gender")!.min).toBe(1);
  });
});

describe("type-resolver integration with loadValidators", () => {
  it("resolves baseDefinition when loading validators", async () => {
    const { loadValidators } = await import("../../src/fhir/validator-loader.ts");

    const baseSD = {
      resourceType: "StructureDefinition" as const,
      id: "Patient",
      url: "http://hl7.org/fhir/StructureDefinition/Patient",
      type: "Patient",
      snapshot: {
        element: [
          { id: "Patient", path: "Patient" },
          { id: "Patient.id", path: "Patient.id", type: [{ code: "id" }], min: 0, max: "1" },
          { id: "Patient.name", path: "Patient.name", type: [{ code: "HumanName" }], min: 0, max: "*" },
        ],
      },
    };

    const profileSD = {
      resourceType: "StructureDefinition" as const,
      id: "my-patient",
      url: "http://example.org/fhir/StructureDefinition/my-patient",
      type: "Patient",
      baseDefinition: "http://hl7.org/fhir/StructureDefinition/Patient",
      differential: {
        element: [
          { id: "Patient.name", path: "Patient.name", min: 1, max: "*", mustSupport: true },
        ],
      },
    };

    const registry = new Map<string, any>();
    registry.set(baseSD.url, baseSD);
    registry.set(profileSD.url, profileSD);

    const { resolveStructureDefinition } = await import("../../src/fhir/schema/type-resolver.ts");
    const resolved = resolveStructureDefinition(profileSD, registry);

    expect(resolved.differential?.element).toBeDefined();
    const elements = resolved.differential!.element;
    expect(elements.length).toBeGreaterThanOrEqual(2);

    const idElement = elements.find(e => e.id === "Patient.id");
    expect(idElement).toBeDefined();
    expect(idElement!.min).toBe(0);

    const nameElement = elements.find(e => e.id === "Patient.name");
    expect(nameElement).toBeDefined();
    expect(nameElement!.min).toBe(1);
    expect(nameElement!.mustSupport).toBe(true);
  });
});
