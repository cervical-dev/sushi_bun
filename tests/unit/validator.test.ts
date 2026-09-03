import { describe, it, expect } from "bun:test";
import { validateResource } from "../../src/fhir/validator.ts";
import type { StructureDefinition } from "../../src/fhir/types.ts";

const myPatientSD: StructureDefinition = {
  resourceType: "StructureDefinition",
  id: "my-patient",
  url: "http://example.org/fhir/StructureDefinition/my-patient",
  type: "Patient",
  differential: {
    element: [
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

function validPatient() {
  return {
    resourceType: "Patient",
    identifier: [{ system: "http://example.org/mrn", value: "12345" }],
    name: [{ family: "Smith", given: ["John"] }],
    gender: "male",
    birthDate: "1990-01-15",
  };
}

describe("validateResource", () => {
  describe("valid resources", () => {
    it("passes for a fully conformant Patient", () => {
      const result = validateResource(validPatient(), myPatientSD);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("passes with optional fields present", () => {
      const resource = {
        ...validPatient(),
        telecom: [{ system: "phone", value: "555-1234", use: "home" }],
        address: [{ city: "Springfield", state: "IL" }],
      };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(true);
    });
  });

  describe("resourceType validation", () => {
    it("fails when resourceType is missing", () => {
      const resource = { name: [{ family: "Smith" }] };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === "invalid-resource-type")).toBe(true);
    });

    it("fails when resourceType does not match SD type", () => {
      const resource = { ...validPatient(), resourceType: "Observation" };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === "invalid-resource-type")).toBe(true);
    });
  });

  describe("cardinality validation", () => {
    it("fails when required array element is empty", () => {
      const resource = { ...validPatient(), identifier: [] };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.identifier")).toBe(true);
    });

    it("fails when required array element is missing", () => {
      const resource = validPatient();
      delete (resource as any).identifier;
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.identifier" && i.code === "cardinality")).toBe(true);
    });

    it("fails when nested required field is missing", () => {
      const resource = { ...validPatient(), name: [{ given: ["John"] }] };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.name[0].family" && i.code === "cardinality")).toBe(true);
    });

    it("fails when name array is empty", () => {
      const resource = { ...validPatient(), name: [] };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.name")).toBe(true);
    });

    it("reports all cardinality violations at once", () => {
      const resource = { resourceType: "Patient" };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("mustSupport validation", () => {
    it("fails when mustSupport element is missing", () => {
      const resource = {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "12345" }],
        name: [{ family: "Smith", given: ["John"] }],
        gender: "male",
      };
      delete (resource as any).birthDate;
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.birthDate" && i.code === "must-support")).toBe(true);
    });
  });

  describe("identifier nested validation", () => {
    it("fails when identifier.system is missing", () => {
      const resource = {
        ...validPatient(),
        identifier: [{ value: "12345" }],
      };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.identifier[0].system" && i.code === "cardinality")).toBe(true);
    });

    it("fails when identifier.value is missing", () => {
      const resource = {
        ...validPatient(),
        identifier: [{ system: "http://example.org/mrn" }],
      };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.identifier[0].value" && i.code === "cardinality")).toBe(true);
    });

    it("validates multiple identifiers", () => {
      const resource = {
        ...validPatient(),
        identifier: [
          { system: "http://example.org/mrn", value: "12345" },
          { value: "67890" },
        ],
      };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.identifier[1].system")).toBe(true);
    });
  });

  describe("multiple names validation", () => {
    it("validates each name entry independently", () => {
      const resource = {
        ...validPatient(),
        name: [
          { family: "Smith", given: ["John"] },
          { given: ["Jane"] },
        ],
      };
      const result = validateResource(resource, myPatientSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.location === "Patient.name[1].family")).toBe(true);
    });
  });

  describe("max cardinality validation", () => {
    const maxSD: StructureDefinition = {
      resourceType: "StructureDefinition",
      id: "test-max",
      url: "http://test/StructureDefinition/test-max",
      type: "Patient",
      differential: {
        element: [
          { id: "Patient.name", path: "Patient.name", min: 0, max: "1" },
        ],
      },
    };

    it("fails when array exceeds max cardinality", () => {
      const resource = {
        resourceType: "Patient",
        name: [
          { family: "Smith", given: ["John"] },
          { family: "Jones", given: ["Jane"] },
        ],
      };
      const result = validateResource(resource, maxSD);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === "cardinality" && i.diagnostics.includes("at most 1"))).toBe(true);
    });

    it("passes when array count equals max", () => {
      const resource = {
        resourceType: "Patient",
        name: [{ family: "Smith", given: ["John"] }],
      };
      const result = validateResource(resource, maxSD);
      expect(result.valid).toBe(true);
    });

    it("passes when max is unbounded (*)", () => {
      const unboundedSD: StructureDefinition = {
        resourceType: "StructureDefinition",
        id: "test-unbounded",
        url: "http://test/StructureDefinition/test-unbounded",
        type: "Patient",
        differential: {
          element: [
            { id: "Patient.name", path: "Patient.name", min: 0, max: "*" },
          ],
        },
      };
      const resource = {
        resourceType: "Patient",
        name: [
          { family: "Smith", given: ["John"] },
          { family: "Jones", given: ["Jane"] },
        ],
      };
      const result = validateResource(resource, unboundedSD);
      expect(result.valid).toBe(true);
    });
  });

  describe("issue structure", () => {
    it("returns error severity for all violations", () => {
      const resource = { resourceType: "Patient" };
      const result = validateResource(resource, myPatientSD);
      for (const issue of result.issues) {
        expect(issue.severity).toBe("error");
      }
    });

    it("includes diagnostics message", () => {
      const resource = { resourceType: "Patient" };
      const result = validateResource(resource, myPatientSD);
      for (const issue of result.issues) {
        expect(issue.diagnostics).toBeTruthy();
      }
    });

    it("includes location for element-level issues", () => {
      const resource = { resourceType: "Patient" };
      const result = validateResource(resource, myPatientSD);
      const elementIssues = result.issues.filter((i) => i.location);
      expect(elementIssues.length).toBeGreaterThan(0);
    });
  });
});

describe("Bug 1.3 — elementIndex key mismatch kills BackboneElement child validation", () => {
  const sd: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-backbone",
    url: "http://test/StructureDefinition/test-backbone",
    type: "Patient",
    differential: {
      element: [
        { id: "Patient.name", path: "Patient.name", min: 1, max: "*" },
        {
          id: "Patient.name.family",
          path: "Patient.name.family",
          min: 1,
          type: [{ code: "string" }],
        },
        {
          id: "Patient.name.given",
          path: "Patient.name.given",
          min: 1,
          max: "*",
          type: [{ code: "string" }],
        },
      ],
    },
  };

  it("validates child elements of a BackboneElement array — missing required child", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ given: ["John"] }],
    };
    const result = validateResource(resource, sd);
    expect(result.valid).toBe(false);
    const familyIssue = result.issues.find(
      (i) => i.location === "Patient.name[0].family" && i.code === "cardinality"
    );
    expect(familyIssue).toBeTruthy();
  });

  it("validates each array item independently — one valid, one invalid", () => {
    const resource = {
      resourceType: "Patient",
      name: [
        { family: "Smith", given: ["John"] },
        { given: ["Jane"] },
      ],
    };
    const result = validateResource(resource, sd);
    expect(result.valid).toBe(false);
    const missingFamily = result.issues.find(
      (i) => i.location === "Patient.name[1].family" && i.code === "cardinality"
    );
    expect(missingFamily).toBeTruthy();
  });
});

describe("Bug 1.4 — primitive/fixed checks skip arrays", () => {
  const sd: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-array-prims",
    url: "http://test/StructureDefinition/test-array-prims",
    type: "Patient",
    differential: {
      element: [
        {
          id: "Patient.name",
          path: "Patient.name",
          min: 1,
          max: "*",
        },
        {
          id: "Patient.name.given",
          path: "Patient.name.given",
          min: 1,
          max: "*",
          type: [{ code: "string" }],
        },
      ],
    },
  };

  it("validates primitive types inside arrays — invalid string in given", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ family: "Smith", given: [12345] }],
    };
    const result = validateResource(resource, sd, {
      checkPrimitives: true,
      checkFixedValues: false,
      checkChoiceTypes: false,
      evaluateConstraints: false,
      checkExtensions: false,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "invalid-type")).toBe(true);
  });

  it("validates primitive types for each array element — multiple bad values", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ family: "Smith", given: [123, true] }],
    };
    const result = validateResource(resource, sd, {
      checkPrimitives: true,
      checkFixedValues: false,
      checkChoiceTypes: false,
      evaluateConstraints: false,
      checkExtensions: false,
    });
    expect(result.valid).toBe(false);
    const typeErrors = result.issues.filter((i) => i.code === "invalid-type");
    expect(typeErrors.length).toBeGreaterThanOrEqual(2);
  });

  const fixedSd: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-fixed-in-array",
    url: "http://test/StructureDefinition/test-fixed-in-array",
    type: "Patient",
    differential: {
      element: [
        {
          id: "Patient.name",
          path: "Patient.name",
          min: 1,
          max: "*",
        },
        {
          id: "Patient.name.use",
          path: "Patient.name.use",
          type: [{ code: "code" }],
          fixedCode: "official",
        },
      ],
    },
  };

  it("validates fixed values inside arrays — wrong fixed code in array item", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ use: "nickname" }],
    };
    const result = validateResource(resource, fixedSd, {
      checkPrimitives: false,
      checkFixedValues: true,
      checkChoiceTypes: false,
      evaluateConstraints: false,
      checkExtensions: false,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "fixed-value")).toBe(true);
  });
});

describe("Bug 1.6 — OperationOutcomeIssue missing location field", () => {
  it("OperationOutcomeIssue interface includes location field", () => {
    const issue: import("../../src/fhir/types.ts").OperationOutcomeIssue = {
      severity: "error",
      code: "cardinality",
      diagnostics: "test",
      location: ["Patient.name[0].family"],
    };
    expect(issue.location).toEqual(["Patient.name[0].family"]);
  });

  it("createOperationOutcomeFromIssues produces location array", async () => {
    const { createOperationOutcomeFromIssues } = require("../../src/handlers/metadata.ts");
    const issues: import("../../src/fhir/types.ts").ValidationIssue[] = [
      { severity: "error", code: "cardinality", diagnostics: "missing", location: "Patient.name[0].family" },
    ];
    const response = createOperationOutcomeFromIssues(issues, 422);
    expect(response).toBeInstanceOf(Response);
    const body = await response.json();
    expect(body.issue[0].location).toEqual(["Patient.name[0].family"]);
  });
});

describe("Bug 1.9 — BackboneElement recursive validation of actual children", () => {
  const deepSd: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-deep-backbone",
    url: "http://test/StructureDefinition/test-deep-backbone",
    type: "Patient",
    differential: {
      element: [
        { id: "Patient.name", path: "Patient.name", min: 1, max: "*" },
        {
          id: "Patient.name.family",
          path: "Patient.name.family",
          min: 1,
          type: [{ code: "string" }],
        },
        {
          id: "Patient.name.given",
          path: "Patient.name.given",
          min: 1,
          max: "*",
          type: [{ code: "string" }],
        },
        {
          id: "Patient.name.given.id",
          path: "Patient.name.given.id",
          type: [{ code: "id" }],
        },
      ],
    },
  };

  it("recursively validates child elements of BackboneElement items", () => {
    const resource = {
      resourceType: "Patient",
      name: [
        { family: "Smith", given: ["John"] },
        { given: ["Jane"] },
      ],
    };
    const result = validateResource(resource, deepSd);
    expect(result.valid).toBe(false);
    const familyMissing = result.issues.find(
      (i) => i.location === "Patient.name[1].family" && i.code === "cardinality"
    );
    expect(familyMissing).toBeTruthy();
  });

  it("validates deeply nested children across multiple array items", () => {
    const resource = {
      resourceType: "Patient",
      name: [
        { family: "Smith", given: ["John"] },
        { family: "Jones", given: ["Jane"] },
      ],
    };
    const result = validateResource(resource, deepSd);
    expect(result.valid).toBe(true);
  });
});

describe("Snapshot-only StructureDefinition fallback", () => {
  const snapshotOnlySD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "snapshot-patient",
    url: "http://example.org/fhir/StructureDefinition/snapshot-patient",
    type: "Patient",
    snapshot: {
      element: [
        { id: "Patient.name", path: "Patient.name", min: 1, max: "*" },
        { id: "Patient.name.family", path: "Patient.name.family", min: 1, type: [{ code: "string" }] },
      ],
    },
  };

  it("validates when SD has only snapshot (no differential)", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ given: ["John"] }],
    };
    const result = validateResource(resource, snapshotOnlySD);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.location === "Patient.name[0].family" && i.code === "cardinality")).toBe(true);
  });

  it("passes when snapshot-only SD resource is valid", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ family: "Smith" }],
    };
    const result = validateResource(resource, snapshotOnlySD);
    expect(result.valid).toBe(true);
  });
});

describe("Single complex type validation (1..1 BackboneElement)", () => {
  const patientSD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-single-complex",
    url: "http://test/StructureDefinition/test-single-complex",
    type: "Patient",
    differential: {
      element: [
        { id: "Patient", path: "Patient" },
        { id: "Patient.contact", path: "Patient.contact", min: 1, max: "1", type: [{ code: "BackboneElement" }] },
        { id: "Patient.contact.name", path: "Patient.contact.name", min: 1, max: "1", type: [{ code: "HumanName" }] },
        { id: "Patient.contact.name.family", path: "Patient.contact.name.family", min: 1, max: "1", type: [{ code: "string" }] },
      ],
    },
  };

  it("validates nested children of a single BackboneElement (not array)", () => {
    const resource = {
      resourceType: "Patient",
      contact: { name: { given: ["John"] } },
    };
    const result = validateResource(resource, patientSD);
    expect(result.valid).toBe(false);
    const familyMissing = result.issues.find(
      (i) => i.location === "Patient.contact.name.family" && i.code === "cardinality"
    );
    expect(familyMissing).toBeTruthy();
  });

  it("passes when single BackboneElement has all required children", () => {
    const resource = {
      resourceType: "Patient",
      contact: { name: { family: "Smith" } },
    };
    const result = validateResource(resource, patientSD);
    expect(result.valid).toBe(true);
  });

  it("checkComplexType runs for single BackboneElement values", () => {
    const resource = {
      resourceType: "Patient",
      contact: {},
    };
    const result = validateResource(resource, patientSD, {
      checkPrimitives: false,
      checkFixedValues: false,
      checkChoiceTypes: false,
      evaluateConstraints: false,
      checkExtensions: false,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "cardinality")).toBe(true);
  });

  it("checkComplexType catches empty single BackboneElement via structural check", () => {
    const resource = {
      resourceType: "Patient",
      contact: {},
    };
    const result = validateResource(resource, patientSD);
    const complexIssue = result.issues.find(
      (i) => i.diagnostics.includes("empty") || i.diagnostics.includes("at least 1 element")
    );
    expect(complexIssue).toBeTruthy();
  });
});

describe("FHIRPath constraint leaf context", () => {
  const constraintSD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-fhirpath-leaf",
    url: "http://test/StructureDefinition/test-fhirpath-leaf",
    type: "Patient",
    differential: {
      element: [
        { id: "Patient.name", path: "Patient.name", min: 1, max: "*" },
        {
          id: "Patient.name.family",
          path: "Patient.name.family",
          min: 1,
          type: [{ code: "string" }],
          constraint: [{
            key: "pat-family-upper",
            severity: "error",
            human: "Family name must be all uppercase",
            expression: "matches('^[A-Z]+$')",
          }],
        },
      ],
    },
  };

  it("evaluates FHIRPath constraint on leaf value, not parent object", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ family: "smith" }],
    };
    const result = validateResource(resource, constraintSD, {
      checkPrimitives: false,
      checkFixedValues: false,
      checkChoiceTypes: false,
      evaluateConstraints: true,
      checkExtensions: false,
    });
    const constraintIssue = result.issues.find((i) => i.code === "invariant");
    expect(constraintIssue).toBeTruthy();
    expect(constraintIssue!.severity).toBe("error");
  });

  it("passes when leaf value matches constraint", () => {
    const resource = {
      resourceType: "Patient",
      name: [{ family: "SMITH" }],
    };
    const result = validateResource(resource, constraintSD, {
      checkPrimitives: false,
      checkFixedValues: false,
      checkChoiceTypes: false,
      evaluateConstraints: true,
      checkExtensions: false,
    });
    const constraintIssue = result.issues.find((i) => i.code === "invariant");
    expect(constraintIssue).toBeUndefined();
  });
});

describe("Bundle validation via validateResource", () => {
  const bundleSD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "Bundle",
    url: "http://hl7.org/fhir/StructureDefinition/Bundle",
    type: "Bundle",
    differential: {
      element: [
        { id: "Bundle.type", path: "Bundle.type", type: [{ code: "code" }], min: 1, max: "1" },
        { id: "Bundle.entry", path: "Bundle.entry", min: 0, max: "*" },
        { id: "Bundle.entry.request", path: "Bundle.entry.request", min: 0, max: "1" },
        { id: "Bundle.entry.request.method", path: "Bundle.entry.request.method", type: [{ code: "code" }], min: 1, max: "1" },
        { id: "Bundle.entry.request.url", path: "Bundle.entry.request.url", type: [{ code: "uri" }], min: 1, max: "1" },
      ],
    },
  };

  it("validates Bundle.type via bundle-validator", () => {
    const resource = {
      resourceType: "Bundle",
      type: "invalid-type",
      entry: [],
    };
    const result = validateResource(resource, bundleSD);
    const typeIssue = result.issues.find((i) => i.location === "Bundle.type" && i.code === "invalid-value");
    expect(typeIssue).toBeTruthy();
  });

  it("validates Bundle.type missing", () => {
    const resource = {
      resourceType: "Bundle",
      entry: [],
    };
    const result = validateResource(resource, bundleSD);
    const typeIssue = result.issues.find((i) => i.location === "Bundle.type" && i.code === "cardinality");
    expect(typeIssue).toBeTruthy();
  });

  it("passes for valid Bundle", () => {
    const resource = {
      resourceType: "Bundle",
      type: "batch",
      entry: [
        { request: { method: "POST", url: "Patient" }, resource: { resourceType: "Patient" } },
      ],
    };
    const result = validateResource(resource, bundleSD);
    expect(result.valid).toBe(true);
  });
});

describe("Binding validation via validateResource", () => {
  const bindingSD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-binding",
    url: "http://test/StructureDefinition/test-binding",
    type: "Observation",
    differential: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.status",
          path: "Observation.status",
          min: 1,
          max: "1",
          type: [{ code: "code" }],
          binding: {
            strength: "required",
            valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
          },
        },
      ],
    },
  };

  it("reports error for code not in bound system (required binding, empty codeSystems)", () => {
    const resource = {
      resourceType: "Observation",
      status: "invalid-status",
    };
    const result = validateResource(resource, bindingSD);
    const bindingIssue = result.issues.find((i) => i.code === "missing-code-system" || i.code === "invalid-code");
    expect(bindingIssue).toBeTruthy();
    expect(bindingIssue!.severity).toBe("error");
  });

  it("reports error for any code when no codeSystems loaded (required binding)", () => {
    const resource = {
      resourceType: "Observation",
      status: { coding: [{ system: "http://hl7.org/fhir/observation-status", code: "final" }] },
    };
    const result = validateResource(resource, bindingSD);
    const bindingIssue = result.issues.find((i) => i.code === "invalid-code");
    expect(bindingIssue).toBeTruthy();
    expect(bindingIssue!.severity).toBe("error");
  });

  it("does not enforce example bindings", () => {
    const exampleSD: StructureDefinition = {
      resourceType: "StructureDefinition",
      id: "test-example-binding",
      url: "http://test/StructureDefinition/test-example-binding",
      type: "Observation",
      differential: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.status",
            path: "Observation.status",
            min: 1,
            max: "1",
            type: [{ code: "code" }],
            binding: {
              strength: "example",
              valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
            },
          },
        ],
      },
    };
    const resource = {
      resourceType: "Observation",
      status: "anything",
    };
    const result = validateResource(resource, exampleSD);
    const bindingIssue = result.issues.find((i) => i.code === "invalid-code" || i.code === "missing-code-system");
    expect(bindingIssue).toBeUndefined();
  });
});

describe("Slicing validation via validateResource", () => {
  const slicedSD: StructureDefinition = {
    resourceType: "StructureDefinition",
    id: "test-slicing",
    url: "http://test/StructureDefinition/test-slicing",
    type: "Patient",
    differential: {
      element: [
        {
          id: "Patient.identifier",
          path: "Patient.identifier",
          slicing: { discriminator: [{ type: "value", path: "type.coding.code" }], rules: "closed" },
          min: 1,
          max: "*",
        },
        { id: "Patient.identifier:mrn", path: "Patient.identifier", sliceName: "mrn", min: 1, max: "1" },
        { id: "Patient.identifier:insurance", path: "Patient.identifier", sliceName: "insurance", min: 0, max: "1" },
      ],
    },
  };

  it("validates closed slicing — rejects unrecognized slices", () => {
    const resource = {
      resourceType: "Patient",
      identifier: [
        { type: { coding: [{ code: "mrn" }] }, system: "http://example.org/mrn", value: "123" },
        { type: { coding: [{ code: "unknown" }] }, system: "http://example.org/unknown", value: "UNK" },
      ],
    };
    const result = validateResource(resource, slicedSD);
    const sliceIssue = result.issues.find((i) => i.code === "unrecognized-slice");
    expect(sliceIssue).toBeTruthy();
  });

  it("validates closed slicing — fails when required slice missing", () => {
    const resource = {
      resourceType: "Patient",
      identifier: [
        { type: { coding: [{ code: "insurance" }] }, system: "http://example.org/insurance", value: "INS1" },
      ],
    };
    const result = validateResource(resource, slicedSD);
    const sliceIssue = result.issues.find((i) => i.code === "missing-slice");
    expect(sliceIssue).toBeTruthy();
  });

  it("passes when all required slices are present", () => {
    const resource = {
      resourceType: "Patient",
      identifier: [
        { type: { coding: [{ code: "mrn" }] }, system: "http://example.org/mrn", value: "123" },
        { type: { coding: [{ code: "insurance" }] }, system: "http://example.org/insurance", value: "INS1" },
      ],
    };
    const result = validateResource(resource, slicedSD);
    const sliceIssues = result.issues.filter((i) => i.code === "unrecognized-slice" || i.code === "missing-slice" || i.code === "too-many-slices");
    expect(sliceIssues).toHaveLength(0);
  });
});
