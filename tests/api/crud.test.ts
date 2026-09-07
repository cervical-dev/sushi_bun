import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestServer, createTestServerWithCapability, createClient, validPatient, noUpdateCreateCapability, expectCreated, type TestServer, type FhirClient } from "../support/index.ts";

const CAPABILITY_PATH = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

describe("Patient CRUD operations", () => {
  let server: TestServer;
  let client: FhirClient;

  beforeEach(async () => {
    server = await createTestServer(CAPABILITY_PATH);
    client = createClient(server.baseUrl);
  });

  afterEach(() => {
    server.stop();
  });

  describe("create", () => {
    it("creates a patient with server-assigned id", async () => {
      const res = await client.create("Patient", validPatient());

      expectCreated(res);
      expect(res.body.id).toBeDefined();
      expect(res.body.resourceType).toBe("Patient");
      expect(res.body.meta?.versionId).toBe("1");
      expect(res.headers.get("Location")).toContain("Patient/");
      expect(res.headers.get("ETag")).toBe('W/"1"');
    });

    it("rejects mismatched resource type", async () => {
      const res = await client.create("Patient", { resourceType: "Observation", status: "final" });

      expect(res.status).toBe(400);
      expect(res.body.resourceType).toBe("OperationOutcome");
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
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.read("Patient", id);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.resourceType).toBe("Patient");
      expect(res.headers.get("ETag")).toBe('W/"1"');
      expect(res.headers.get("Last-Modified")).toBeDefined();
    });

    it("returns 404 for non-existent patient", async () => {
      const res = await client.read("Patient", "non-existent");
      expect(res.status).toBe(404);
      expect(res.body.resourceType).toBe("OperationOutcome");
    });
  });

  describe("update", () => {
    it("updates a patient", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.update("Patient", id, {
        name: [{ family: "Updated", given: ["Jane"] }],
        gender: "female",
        birthDate: "1985-05-20",
        identifier: [{ system: "http://example.org/mrn", value: "67890" }],
      });

      expect(res.status).toBe(200);
      expect(res.body.meta?.versionId).toBe("2");
      expect(res.body.name[0].family).toBe("Updated");
    });

    it("returns 412 on version conflict", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.update("Patient", id, {
        name: [{ family: "Conflict", given: ["Version"] }],
        gender: "male",
        birthDate: "1990-01-01",
        identifier: [{ system: "http://example.org/mrn", value: "conflict" }],
      }, 'W/"999"');

      expect(res.status).toBe(412);
    });

    it("succeeds with correct If-Match", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.update("Patient", id, {
        name: [{ family: "Matched", given: ["Jane"] }],
        gender: "male",
        birthDate: "1990-01-01",
        identifier: [{ system: "http://example.org/mrn", value: "match" }],
      }, 'W/"1"');

      expect(res.status).toBe(200);
    });

    it("returns 400 when body id does not match URL id", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await fetch(`${server.baseUrl}/Patient/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify({
          resourceType: "Patient",
          id: "wrong-id",
          name: [{ family: "Mismatch" }],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("OperationOutcome");
    });

    it("returns 400 for invalid If-Match format", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.update("Patient", id, {
        name: [{ family: "Test", given: ["IfMatch"] }],
        gender: "female",
        birthDate: "1990-01-01",
        identifier: [{ system: "http://example.org/mrn", value: "ifmatch-test" }],
      }, "garbage-value");

      expect(res.status).toBe(400);
      expect(res.body.resourceType).toBe("OperationOutcome");
    });

    it("returns 404 for non-existent patient when updateCreate is false", async () => {
      const noUpdateServer = await createTestServerWithCapability(noUpdateCreateCapability);
      const noUpdateClient = createClient(noUpdateServer.baseUrl);
      try {
        const res = await noUpdateClient.update("Patient", "non-existent-id", {
          name: [{ family: "Ghost", given: ["Nonexistent"] }],
          gender: "male",
          birthDate: "2000-01-01",
          identifier: [{ system: "http://example.org/mrn", value: "ghost" }],
        });

        expect(res.status).toBe(404);
        expect(res.body.resourceType).toBe("OperationOutcome");
      } finally {
        noUpdateServer.stop();
      }
    });

    it("creates on PUT when updateCreate is true", async () => {
      const res = await client.update("Patient", "update-create-id", {
        name: [{ family: "Created", given: ["Alice"] }],
        gender: "female",
        birthDate: "1995-06-15",
        identifier: [{ system: "http://example.org/mrn", value: "uc1" }],
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("update-create-id");
      expect(res.body.meta?.versionId).toBe("1");
      expect(res.headers.get("Location")).toContain("Patient/update-create-id");
    });
  });

  describe("delete", () => {
    it("deletes a patient", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.delete("Patient", id);
      expect(res.status).toBe(204);

      const readRes = await client.read("Patient", id);
      expect(readRes.status).toBe(410);
      expect(readRes.body.resourceType).toBe("OperationOutcome");
      expect(readRes.headers.get("ETag")).toBeDefined();
    });

    it("returns 404 for never-existent patient", async () => {
      const res = await client.delete("Patient", "non-existent");
      expect(res.status).toBe(404);
    });

    it("deleting already-deleted resource returns success", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const firstDelete = await client.delete("Patient", id);
      expect(firstDelete.status).toBe(204);

      const secondDelete = await client.delete("Patient", id);
      expect(secondDelete.status).toBe(204);
    });

    it("returns proper headers on delete", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.delete("Patient", id);
      expect(res.status).toBe(204);
      expect(res.headers.get("ETag")).toBeDefined();
    });

    it("vread of deleted version returns gone", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;
      await client.delete("Patient", id);

      const res = await client.vread("Patient", id, "2");
      expect(res.status).toBe(410);
      expect(res.body.resourceType).toBe("OperationOutcome");
    });

    it("vread of pre-delete version still returns 200", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;
      await client.update("Patient", id, { ...createRes.body, gender: "female" });
      await client.delete("Patient", id);

      const res = await client.vread("Patient", id, "1");
      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe("Patient");
    });
  });

  describe("history", () => {
    it("returns version history", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;
      await client.update("Patient", id, { ...createRes.body, gender: "female" });

      const res = await client.history("Patient", id);
      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe("Bundle");
      expect(res.body.type).toBe("history");
      expect(res.body.entry.length).toBe(2);
    });

    it("returns 404 for history on non-existent resource", async () => {
      const res = await client.history("Patient", "non-existent");
      expect(res.status).toBe(404);
    });

    it("includes delete in version history", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;
      await client.delete("Patient", id);

      const res = await client.history("Patient", id);
      expect(res.status).toBe(200);
      expect(res.body.entry.length).toBe(2);
    });

    it("returns type-level history across resources", async () => {
      await client.create("Patient", validPatient());
      await client.create("Patient", validPatient());

      const res = await client.history("Patient");
      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe("Bundle");
      expect(res.body.type).toBe("history");
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it("returns system-level history across all types", async () => {
      await client.create("Patient", validPatient());

      const res = await fetch(`${server.baseUrl}/_history`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;
      expect(body.resourceType).toBe("Bundle");
      expect(body.type).toBe("history");
      expect(body.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe("version read", () => {
    it("reads a specific version", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;
      await client.update("Patient", id, { ...createRes.body, gender: "female" });

      const res = await client.vread("Patient", id, "1");
      expect(res.status).toBe(200);
      expect(res.body.meta?.versionId).toBe("1");
    });

    it("returns 404 for non-existent version", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.vread("Patient", id, "999");
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid version id", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.vread("Patient", id, "notanumber");
      expect(res.status).toBe(400);
    });
  });

  describe("patch", () => {
    it("applies json patch and returns updated resource", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.patch("Patient", id, [
        { op: "replace", path: "/gender", value: "female" },
      ]);

      expect(res.status).toBe(200);
      expect(res.body.gender).toBe("female");
      expect(res.body.meta?.versionId).toBe("2");
      expect(res.headers.get("ETag")).toBe('W/"2"');
      expect(res.headers.get("Location")).toContain(`/Patient/${id}/_history/2`);
    });

    it("returns not found for non-existent resource", async () => {
      const res = await client.patch("Patient", "non-existent", [
        { op: "replace", path: "/gender", value: "female" },
      ]);

      expect(res.status).toBe(404);
      expect(res.body.resourceType).toBe("OperationOutcome");
    });

    it("returns conflict on version mismatch", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.patch("Patient", id, [
        { op: "replace", path: "/gender", value: "female" },
      ], 'W/"999"');

      expect(res.status).toBe(412);
    });

    it("rejects unsupported content type", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await fetch(`${server.baseUrl}/Patient/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "text/plain" },
        body: "not json patch",
      });

      expect(res.status).toBe(415);
    });

    it("rejects invalid patch operations", async () => {
      const createRes = await client.create("Patient", validPatient());
      const id = createRes.body.id;

      const res = await client.patch("Patient", id, [
        { op: "invalid-op", path: "/gender" },
      ]);

      expect(res.status).toBe(422);
    });
  });
});
