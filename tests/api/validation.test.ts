import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestServer, createClient, validPatient, type TestServer, type FhirClient } from "../support/index.ts";

describe("FHIR Validation", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  describe("create validation", () => {
    it("accepts a valid Patient", async () => {
      const res = await client.create("Patient", validPatient());

      expect(res.status).toBe(201);
      expect(res.body.resourceType).toBe("Patient");
    });

    it("rejects Patient missing required identifier", async () => {
      const resource = {
        resourceType: "Patient",
        name: [{ family: "Smith", given: ["John"] }],
        gender: "male",
        birthDate: "1990-01-15",
      };

      const res = await client.create("Patient", resource);

      expect(res.status).toBe(422);
      expect(res.body.resourceType).toBe("OperationOutcome");
      expect(res.body.issue.length).toBeGreaterThan(0);
      expect(res.body.issue.some((i: any) => i.severity === "error")).toBe(true);
    });

    it("rejects Patient missing name.family", async () => {
      const resource = {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "12345" }],
        name: [{ given: ["John"] }],
        gender: "male",
        birthDate: "1990-01-15",
      };

      const res = await client.create("Patient", resource);

      expect(res.status).toBe(422);
      expect(res.body.resourceType).toBe("OperationOutcome");
      expect(res.body.issue.some((i: any) => i.location?.includes("Patient.name[0].family"))).toBe(true);
    });

    it("rejects Patient missing gender", async () => {
      const resource = {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "12345" }],
        name: [{ family: "Smith", given: ["John"] }],
        birthDate: "1990-01-15",
      };

      const res = await client.create("Patient", resource);

      expect(res.status).toBe(422);
      expect(res.body.issue.some((i: any) => i.location?.includes("Patient.gender"))).toBe(true);
    });

    it("rejects Patient missing birthDate", async () => {
      const resource = {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "12345" }],
        name: [{ family: "Smith", given: ["John"] }],
        gender: "male",
      };

      const res = await client.create("Patient", resource);

      expect(res.status).toBe(422);
      expect(res.body.issue.some((i: any) => i.location?.includes("Patient.birthDate"))).toBe(true);
    });

    it("returns multiple errors at once", async () => {
      const resource = { resourceType: "Patient" };

      const res = await client.create("Patient", resource);

      expect(res.status).toBe(422);
      expect(res.body.issue.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("update validation", () => {
    it("rejects update with missing required fields", async () => {
      const created = await client.create("Patient", validPatient());

      const res = await client.update("Patient", created.body.id, {
        resourceType: "Patient",
        name: [{ family: "Updated" }],
      });

      expect(res.status).toBe(422);
      expect(res.body.resourceType).toBe("OperationOutcome");
    });

    it("accepts update with all required fields", async () => {
      const created = await client.create("Patient", validPatient());

      const res = await client.update("Patient", created.body.id, {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "updated" }],
        name: [{ family: "Updated", given: ["Jane"] }],
        gender: "female",
        birthDate: "1985-05-20",
      });

      expect(res.status).toBe(200);
    });
  });

  describe("$validate operation", () => {
    it("returns OperationOutcome with no errors for valid resource", async () => {
      const res = await client.validate("Patient", validPatient());

      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe("OperationOutcome");
      const errors = res.body.issue.filter((i: any) => i.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("returns OperationOutcome with errors for invalid resource", async () => {
      const invalidPatient = { resourceType: "Patient" };

      const res = await client.validate("Patient", invalidPatient);

      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe("OperationOutcome");
      const errors = res.body.issue.filter((i: any) => i.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
    });

    it("reports all validation issues", async () => {
      const invalidPatient = { resourceType: "Patient" };

      const res = await client.validate("Patient", invalidPatient);

      expect(res.body.issue.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("bundle entry validation", () => {
    it("rejects bundle with invalid entry resource", async () => {
      const res = await client.batch([
        {
          resource: { resourceType: "Patient" },
          method: "POST",
          url: "Patient",
        },
      ]);

      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe("Bundle");
      const entry = res.body.entry[0];
      expect(entry.response.status).not.toBe("201");
    });

    it("accepts bundle with valid entry resources", async () => {
      const res = await client.batch([
        {
          resource: validPatient(),
          method: "POST",
          url: "Patient",
        },
      ]);

      expect(res.status).toBe(200);
      expect(res.body.entry[0].response.status).toBe("201");
    });
  });
});
