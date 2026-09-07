import type { FhirResource } from "../../src/fhir/types.ts";

let idCounter = 0;
function uniqueId(): string {
  return `test-${Date.now()}-${++idCounter}`;
}

export function validPatient(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    resourceType: "Patient",
    identifier: [{ system: "http://example.org/mrn", value: uniqueId() }],
    name: [{ family: "Smith", given: ["John"] }],
    gender: "male",
    birthDate: "1990-01-15",
    ...overrides,
  };
}

export function validObservation(patientRef: string, overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    subject: { reference: patientRef },
    ...overrides,
  };
}

export function invalidPatientMissingName(): Record<string, unknown> {
  return {
    resourceType: "Patient",
    gender: "male",
    birthDate: "1990-01-15",
    identifier: [{ system: "http://example.org/mrn", value: uniqueId() }],
  };
}

export function invalidPatientBadGender(): Record<string, unknown> {
  return {
    resourceType: "Patient",
    name: [{ family: "Smith", given: ["John"] }],
    gender: "invalid-gender",
    birthDate: "1990-01-15",
    identifier: [{ system: "http://example.org/mrn", value: uniqueId() }],
  };
}

export function invalidPatientBadBirthDate(): Record<string, unknown> {
  return {
    resourceType: "Patient",
    name: [{ family: "Smith", given: ["John"] }],
    gender: "male",
    birthDate: "not-a-date",
    identifier: [{ system: "http://example.org/mrn", value: uniqueId() }],
  };
}

export function mismatchedResourceType(): Record<string, unknown> {
  return {
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
  };
}

export function bundleBatch(entries: Array<{ resource: Record<string, unknown>; method: string; url: string }>): Record<string, unknown> {
  return {
    resourceType: "Bundle",
    type: "batch",
    entry: entries.map((e) => ({
      resource: e.resource,
      request: { method: e.method, url: e.url },
    })),
  };
}

export function bundleTransaction(entries: Array<{ resource: Record<string, unknown>; method: string; url: string }>): Record<string, unknown> {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries.map((e) => ({
      resource: e.resource,
      request: { method: e.method, url: e.url },
    })),
  };
}

export function patientSD(): Record<string, unknown> {
  return {
    resourceType: "StructureDefinition",
    id: "my-patient",
    url: "http://example.org/fhir/StructureDefinition/my-patient",
    type: "Patient",
    differential: {
      element: [
        { id: "Patient", path: "Patient", min: 1, max: "1" },
        { id: "Patient.identifier", path: "Patient.identifier", min: 1, max: "*", mustSupport: true },
        { id: "Patient.identifier.system", path: "Patient.identifier.system", min: 1 },
        { id: "Patient.identifier.value", path: "Patient.identifier.value", min: 1 },
        { id: "Patient.name", path: "Patient.name", min: 1, max: "*", mustSupport: true },
        { id: "Patient.name.family", path: "Patient.name.family", min: 1, mustSupport: true },
        { id: "Patient.name.given", path: "Patient.name.given", min: 1, max: "*", mustSupport: true },
        { id: "Patient.gender", path: "Patient.gender", min: 1, mustSupport: true },
        { id: "Patient.birthDate", path: "Patient.birthDate", min: 1, mustSupport: true },
        { id: "Patient.telecom", path: "Patient.telecom", mustSupport: true },
        { id: "Patient.address", path: "Patient.address", mustSupport: true },
      ],
    },
  };
}
