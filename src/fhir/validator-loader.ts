import type { StructureDefinition } from "./types.ts";

export interface ValidatorRegistry {
  getValidator(resourceType: string, profileUrl?: string): StructureDefinition | undefined;
  getAll(): Map<string, StructureDefinition>;
}

export async function loadValidators(
  sdDir: string = "fsh-generated/resources"
): Promise<ValidatorRegistry> {
  const byType = new Map<string, StructureDefinition[]>();
  const byUrl = new Map<string, StructureDefinition>();

  try {
    const entries = await Array.fromAsync(new Bun.Glob("StructureDefinition-*.json").scan({ cwd: sdDir }));

    for (const entry of entries) {
      const file = Bun.file(`${sdDir}/${entry}`);
      const sd = (await file.json()) as StructureDefinition;

      if (!sd.type || !sd.url) continue;

      const existing = byType.get(sd.type) ?? [];
      existing.push(sd);
      byType.set(sd.type, existing);
      byUrl.set(sd.url, sd);
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      // Directory does not exist — no validators loaded
    } else {
      throw err;
    }
  }

  return {
    getValidator(resourceType: string, profileUrl?: string): StructureDefinition | undefined {
      if (profileUrl) {
        const byProfile = byUrl.get(profileUrl);
        if (byProfile) return byProfile;
      }

      const sds = byType.get(resourceType);
      if (!sds || sds.length === 0) return undefined;

      return sds.find((sd) => sd.differential?.element && sd.differential.element.length > 0) ?? sds[0];
    },

    getAll(): Map<string, StructureDefinition> {
      const all = new Map<string, StructureDefinition>();
      for (const [url, sd] of byUrl) {
        all.set(url, sd);
      }
      return all;
    },
  };
}
