import type { StructureDefinition } from "./types.ts";
import { resolveStructureDefinition } from "./schema/type-resolver.ts";

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
      console.warn(`[validator-loader] No StructureDefinitions found in "${sdDir}" — directory does not exist`);
    } else {
      throw err;
    }
  }

  if (byType.size === 0) {
    console.warn(`[validator-loader] No StructureDefinitions loaded from "${sdDir}"`);
  }

  for (const [url, sd] of byUrl) {
    if (sd.baseDefinition) {
      const resolved = resolveStructureDefinition(sd, byUrl);
      byUrl.set(url, resolved);
      const typeList = byType.get(sd.type);
      if (typeList) {
        const idx = typeList.findIndex(s => s.url === url);
        if (idx >= 0) typeList[idx] = resolved;
      }
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
