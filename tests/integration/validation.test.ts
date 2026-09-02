import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, samplePatient, type TestServer } from "../helpers.ts";

describe("FHIR Validation", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
  });

  afterAll(() => {
    server.stop();
  });

  describe("create validation", () => {
    it("accepts a valid Patient", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(samplePatient()),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("Patient");
    });

    it("rejects Patient missing required identifier", async () => {
      const resource = {
        resourceType: "Patient",
        name: [{ family: "Smith", given: ["John"] }],
        gender: "male",
        birthDate: "1990-01-15",
      };

      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(resource),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
      expect(body.issue.length).toBeGreaterThan(0);
      expect(body.issue.some((i: any) => i.severity === "error")).toBe(true);
    });

    it("rejects Patient missing name.family", async () => {
      const resource = {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "12345" }],
        name: [{ given: ["John"] }],
        gender: "male",
        birthDate: "1990-01-15",
      };

      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(resource),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
      expect(body.issue.some((i: any) => i.location?.includes("Patient.name[0].family"))).toBe(true);
    });

    it("rejects Patient missing gender", async () => {
      const resource = {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "12345" }],
        name: [{ family: "Smith", given: ["John"] }],
        birthDate: "1990-01-15",
      };

      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(resource),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as Record<string, any>;
      expect(body.issue.some((i: any) => i.location?.includes("Patient.gender"))).toBe(true);
    });

    it("rejects Patient missing birthDate", async () => {
      const resource = {
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/mrn", value: "12345" }],
        name: [{ family: "Smith", given: ["John"] }],
        gender: "male",
      };

      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(resource),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as Record<string, any>;
      expect(body.issue.some((i: any) => i.location?.includes("Patient.birthDate"))).toBe(true);
    });

    it("returns multiple errors at once", async () => {
      const resource = { resourceType: "Patient" };

      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(resource),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as Record<string, any>;
      expect(body.issue.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("update validation", () => {
    it("rejects update with missing required fields", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Patient",
          id: created.id,
          name: [{ family: "Updated" }],
        }),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
    });

    it("accepts update with all required fields", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Patient",
          id: created.id,
          identifier: [{ system: "http://example.org/mrn", value: "updated" }],
          name: [{ family: "Updated", given: ["Jane"] }],
          gender: "female",
          birthDate: "1985-05-20",
        }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe("$validate operation", () => {
    it("returns OperationOutcome with no errors for valid resource", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/$validate`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(samplePatient()),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
      const errors = body.issue.filter((i: any) => i.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("returns OperationOutcome with errors for invalid resource", async () => {
      const invalidPatient = { resourceType: "Patient" };

      const res = await fetch(`${server.baseUrl}/Patient/$validate`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(invalidPatient),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
      const errors = body.issue.filter((i: any) => i.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
    });

    it("reports all validation issues", async () => {
      const invalidPatient = { resourceType: "Patient" };

      const res = await fetch(`${server.baseUrl}/Patient/$validate`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(invalidPatient),
      });

      const body = await res.json() as Record<string, any>;
      expect(body.issue.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("bundle entry validation", () => {
    it("rejects bundle with invalid entry resource", async () => {
      const bundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: [
          {
            request: { method: "POST", url: "Patient" },
            resource: { resourceType: "Patient" },
          },
        ],
      };

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(bundle),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("Bundle");
      const entry = body.entry[0];
      expect(entry.response.status).not.toBe("201");
    });

    it("accepts bundle with valid entry resources", async () => {
      const bundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: [
          {
            request: { method: "POST", url: "Patient" },
            resource: samplePatient(),
          },
        ],
      };

      const res = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(bundle),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.entry[0].response.status).toBe("201");
    });
  });
});
