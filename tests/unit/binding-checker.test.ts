import { describe, it, expect } from "bun:test";
import { checkBinding } from "../../src/fhir/terminology/binding-checker.ts";
import type { ElementBinding, ValidationIssue } from "../../src/fhir/types.ts";

describe("checkBinding", () => {
  const observationStatusBinding: ElementBinding = {
    strength: "required",
    valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
  };

  const observationStatusSystem = "http://hl7.org/fhir/observation-status";

  const codeSystems = new Map<string, Set<string>>([
    [observationStatusSystem, new Set(["registered", "preliminary", "final", "amended", "corrected", "cancelled", "entered-in-error", "unknown"])],
    ["http://loinc.org", new Set(["8867-4", "29463-7", "8873-1"])],
    ["http://snomed.info/sct", new Set(["386661006", "260385009"])],
  ]);

  describe("required binding (FHIR Spec §5.1.1)", () => {
    it("passes for valid code in bound system", () => {
      const issues = checkBinding("final", observationStatusSystem, observationStatusBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });

    it("fails for invalid code not in bound system", () => {
      const issues = checkBinding("invalid-status", observationStatusSystem, observationStatusBinding, codeSystems);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("code-not-in-value-set");
      expect(issues[0]!.severity).toBe("error");
    });

    it("fails for code with no system when binding is required", () => {
      const issues = checkBinding("final", undefined, observationStatusBinding, codeSystems);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("missing-code-system");
    });

    it("fails for empty code string", () => {
      const issues = checkBinding("", observationStatusSystem, observationStatusBinding, codeSystems);
      expect(issues).toHaveLength(1);
    });
  });

  describe("extensible binding", () => {
    const extensibleBinding: ElementBinding = {
      strength: "extensible",
      valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
    };

    it("passes for valid code in bound system", () => {
      const issues = checkBinding("final", observationStatusSystem, extensibleBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });

    it("warns for code not in bound system", () => {
      const issues = checkBinding("custom-code", "http://custom.org/system", extensibleBinding, codeSystems);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("warning");
      expect(issues[0]!.code).toBe("code-not-in-value-set");
    });

    it("passes for valid code in unbound system (extensible)", () => {
      const issues = checkBinding("8867-4", "http://loinc.org", extensibleBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });
  });

  describe("preferred binding", () => {
    const preferredBinding: ElementBinding = {
      strength: "preferred",
      valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
    };

    it("passes for valid code", () => {
      const issues = checkBinding("final", observationStatusSystem, preferredBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });

    it("gives information for code not in bound system", () => {
      const issues = checkBinding("custom", "http://custom.org", preferredBinding, codeSystems);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("information");
    });
  });

  describe("example binding", () => {
    const exampleBinding: ElementBinding = {
      strength: "example",
      valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
    };

    it("passes for any code (example binding not enforced)", () => {
      const issues = checkBinding("anything", "http://any.system", exampleBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });
  });

  describe("no binding", () => {
    it("returns empty when no binding specified", () => {
      const issues = checkBinding("final", observationStatusSystem, undefined, codeSystems);
      expect(issues).toHaveLength(0);
    });
  });

  describe("null/undefined code handling", () => {
    it("returns empty for null code", () => {
      const issues = checkBinding(null, observationStatusSystem, observationStatusBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });

    it("returns empty for undefined code", () => {
      const issues = checkBinding(undefined, observationStatusSystem, observationStatusBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });
  });

  describe("code in multiple systems", () => {
    it("passes when code exists in any registered system", () => {
      const issues = checkBinding("8867-4", "http://loinc.org", observationStatusBinding, codeSystems);
      expect(issues).toHaveLength(0);
    });
  });

  describe("empty code systems registry", () => {
    it("still validates with basic checks", () => {
      const emptyRegistry = new Map<string, Set<string>>();
      const issues = checkBinding("final", observationStatusSystem, observationStatusBinding, emptyRegistry);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe("invalid-code");
    });
  });
});
