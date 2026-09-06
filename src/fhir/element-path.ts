export interface ResolvedNode {
  node: unknown;
  pathWithIndices: string[];
}

export function resolvePathNodes(
  obj: Record<string, unknown>,
  pathParts: string[],
  startIdx: number = 0,
  currentPath: string[] = []
): ResolvedNode[] {
  if (startIdx >= pathParts.length) {
    return [{ node: obj, pathWithIndices: currentPath }];
  }

  const key = pathParts[startIdx]!;
  const current = obj[key];

  if (current === undefined || current === null) return [];

  if (Array.isArray(current)) {
    const results: ResolvedNode[] = [];
    for (let i = 0; i < current.length; i++) {
      const item = current[i];
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const itemPath = [...currentPath, `${key}[${i}]`];
        const sub = resolvePathNodes(item as Record<string, unknown>, pathParts, startIdx + 1, itemPath);
        results.push(...sub);
      }
    }
    return results;
  }

  if (typeof current === "object") {
    return resolvePathNodes(current as Record<string, unknown>, pathParts, startIdx + 1, [...currentPath, key]);
  }

  return [];
}

export function formatLocation(resourceType: string, pathWithIndices: string[], leafName: string): string {
  const parts = [resourceType];
  for (const segment of pathWithIndices) {
    parts.push(`.${segment}`);
  }
  if (leafName) {
    parts.push(`.${leafName}`);
  }
  return parts.join("");
}

export function parseMax(max: string | undefined): number | undefined {
  if (max === undefined || max === "*") return undefined;
  const n = parseInt(max, 10);
  return isNaN(n) ? undefined : n;
}

export function countValue(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return Array.isArray(value) ? value.length : 1;
}
