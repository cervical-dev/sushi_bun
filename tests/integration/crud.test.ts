import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestServer, samplePatient, type TestServer } from "../helpers.ts";

describe("Patient CRUD operations", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer("fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json");
  });

  afterAll(() => {
    server.stop();
  });

  describe("create", () => {
    it("creates a patient with server-assigned id", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(samplePatient()),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.resourceType).toBe("Patient");
      expect(body.meta?.versionId).toBe("1");
      expect(res.headers.get("Location")).toContain("Patient/");
      expect(res.headers.get("ETag")).toBe('W/"1"');
    });

    it("rejects mismatched resource type", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({ resourceType: "Observation", status: "final" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.resourceType).toBe("OperationOutcome");
    });

    it("rejects non-JSON content type", async () => {
      const res = await fetch(`${server.baseUrl}/Patient`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      });

      expect(res.status).toBe(415);
    });
  });

  describe("read", () => {
    it("reads a created patient", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.resourceType).toBe("Patient");
      expect(res.headers.get("ETag")).toBe('W/"1"');
      expect(res.headers.get("Last-Modified")).toBeDefined();
    });

    it("returns 404 for non-existent patient", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/non-existent`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.resourceType).toBe("OperationOutcome");
    });
  });

  describe("update", () => {
    it("updates a patient", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Patient",
          id: created.id,
          name: [{ family: "Updated", given: ["Jane"] }],
          gender: "female",
          birthDate: "1985-05-20",
          identifier: [{ system: "http://example.org/mrn", value: "67890" }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meta?.versionId).toBe("2");
      expect(body.name[0].family).toBe("Updated");
    });

    it("returns 412 on version conflict", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/fhir+json",
          "If-Match": 'W/"999"',
        },
        body: JSON.stringify({
          resourceType: "Patient",
          id: created.id,
          name: [{ family: "Conflict" }],
        }),
      });

      expect(res.status).toBe(412);
    });

    it("succeeds with correct If-Match", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/fhir+json",
          "If-Match": 'W/"1"',
        },
        body: JSON.stringify({
          resourceType: "Patient",
          id: created.id,
          name: [{ family: "Matched" }],
          gender: "male",
          birthDate: "1990-01-01",
          identifier: [{ system: "http://example.org/mrn", value: "match" }],
        }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 when body id does not match URL id", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Patient",
          id: "wrong-id",
          name: [{ family: "Mismatch" }],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.resourceType).toBe("OperationOutcome");
    });

    it("returns 400 for invalid If-Match format", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/fhir+json",
          "If-Match": "garbage-value",
        },
        body: JSON.stringify({
          resourceType: "Patient",
          id: created.id,
          name: [{ family: "Test" }],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.resourceType).toBe("OperationOutcome");
    });

    it("returns 404 for non-existent patient when updateCreate is false", async () => {
      const config = server.config.resources.get("Patient")!;
      const originalUpdateCreate = config.updateCreate;
      config.updateCreate = false;

      try {
        const res = await fetch(`${server.baseUrl}/Patient/non-existent-id`, {
          method: "PUT",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify({
            resourceType: "Patient",
            id: "non-existent-id",
            name: [{ family: "Ghost" }],
            gender: "male",
            birthDate: "2000-01-01",
            identifier: [{ system: "http://example.org/mrn", value: "ghost" }],
          }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.resourceType).toBe("OperationOutcome");
      } finally {
        config.updateCreate = originalUpdateCreate;
      }
    });

    it("creates on PUT when updateCreate is true", async () => {
      const config = server.config.resources.get("Patient")!;
      const originalUpdateCreate = config.updateCreate;
      config.updateCreate = true;

      try {
        const res = await fetch(`${server.baseUrl}/Patient/update-create-id`, {
          method: "PUT",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify({
            resourceType: "Patient",
            id: "update-create-id",
            name: [{ family: "Created" }],
            gender: "female",
            birthDate: "1995-06-15",
            identifier: [{ system: "http://example.org/mrn", value: "uc1" }],
          }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toBe("update-create-id");
        expect(body.meta?.versionId).toBe("1");
        expect(res.headers.get("Location")).toContain("Patient/update-create-id");
      } finally {
        config.updateCreate = originalUpdateCreate;
      }
    });
  });

  describe("delete", () => {
    it("deletes a patient", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(204);

      const readRes = await fetch(`${server.baseUrl}/Patient/${created.id}`);
      expect(readRes.status).toBe(404);
    });

    it("returns 404 for non-existent patient", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/non-existent`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("returns proper headers on delete", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("Content-Type")).toBe("application/fhir+json");
      expect(res.headers.get("ETag")).toBe('W/"2"');
    });
  });

  describe("history", () => {
    it("returns version history", async () => {
      const created = server.store.create("Patient", samplePatient());
      server.store.update("Patient", created.id!, { ...samplePatient(), gender: "female" });

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}/_history`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resourceType).toBe("Bundle");
      expect(body.type).toBe("history");
      expect(body.entry.length).toBe(2);
    });

    it("returns 404 for history on non-existent resource", async () => {
      const res = await fetch(`${server.baseUrl}/Patient/non-existent/_history`);
      expect(res.status).toBe(404);
    });

    it("includes delete in version history", async () => {
      const created = server.store.create("Patient", samplePatient());
      server.store.softDelete("Patient", created.id!);

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}/_history`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entry.length).toBe(2);
    });
  });

  describe("version read", () => {
    it("reads a specific version", async () => {
      const created = server.store.create("Patient", samplePatient());
      server.store.update("Patient", created.id!, { ...samplePatient(), gender: "female" });

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}/_history/1`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meta?.versionId).toBe("1");
    });

    it("returns 404 for non-existent version", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}/_history/999`);
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid version id", async () => {
      const created = server.store.create("Patient", samplePatient());

      const res = await fetch(`${server.baseUrl}/Patient/${created.id}/_history/notanumber`);
      expect(res.status).toBe(400);
    });
  });
});
