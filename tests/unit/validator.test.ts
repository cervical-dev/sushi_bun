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
