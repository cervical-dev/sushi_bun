import { describe, it, expect, afterAll } from "bun:test";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "../../src/server.ts";
import { createSqliteStore } from "../../src/store/sqlite-provider.ts";
import { defaultHandlers } from "../../src/handlers/default.ts";

function writeTempCapability(capability: Record<string, unknown>): string {
  const tmpFile = join(tmpdir(), `capability-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(capability));
  return tmpFile;
}

const readOnlyCapability: Record<string, unknown> = {
  resourceType: "CapabilityStatement",
  status: "active",
  date: "2026-01-01",
  kind: "instance",
  fhirVersion: "5.0.0",
  format: ["json"],
  rest: [
    {
      mode: "server",
      resource: [
        {
          type: "Patient",
          interaction: [{ code: "read" }],
        },
      ],
    },
  ],
};

const fullCapability: Record<string, unknown> = {
  resourceType: "CapabilityStatement",
  status: "active",
  date: "2026-01-01",
  kind: "instance",
  fhirVersion: "5.0.0",
  format: ["json"],
  rest: [
    {
      mode: "server",
      interaction: [
        { code: "transaction" },
        { code: "batch" },
      ],
      resource: [
        {
          type: "Patient",
          interaction: [
            { code: "read" },
            { code: "create" },
            { code: "update" },
            { code: "delete" },
            { code: "patch" },
            { code: "search-type" },
            { code: "history-instance" },
            { code: "history-type" },
          ],
        },
      ],
    },
  ],
};

describe("createServer handler validation", () => {
  it("rejects surplus handlers at startup", async () => {
    const capabilityPath = writeTempCapability(readOnlyCapability);
    try {
      const handlers = { handleRead: () => new Response(), handlePatch: () => new Response() } as any;
      await expect(
        createServer({ port: 0, capabilityPath, handlers })
      ).rejects.toThrow(/handlePatch/i);
    } finally {
      unlinkSync(capabilityPath);
    }
  });

  it("rejects missing handlers at startup", async () => {
    const capabilityPath = writeTempCapability(fullCapability);
    try {
      const handlers = { handleRead: () => new Response() } as any;
      await expect(
        createServer({ port: 0, capabilityPath, handlers })
      ).rejects.toThrow(/Missing required handlers/i);
    } finally {
      unlinkSync(capabilityPath);
    }
  });

  it("accepts exact handler match", async () => {
    const capabilityPath = writeTempCapability(readOnlyCapability);
    try {
      const handlers = { handleRead: () => new Response() } as any;
      const { server } = await createServer({ port: 0, capabilityPath, handlers });
      expect(server).toBeDefined();
      server.stop();
    } finally {
      try { unlinkSync(capabilityPath); } catch {}
    }
  });

  it("does not validate defaultHandlers (they are always complete)", async () => {
    const capabilityPath = writeTempCapability(readOnlyCapability);
    try {
      const { server } = await createServer({ port: 0, capabilityPath });
      expect(server).toBeDefined();
      server.stop();
    } finally {
      try { unlinkSync(capabilityPath); } catch {}
    }
  });
});
