export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePath(doc: unknown, path: string[], op?: string): { target: any; key: string | number; parent: any } | null {
  if (path.length === 0) return null;
  let current: any = doc;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (current == null || typeof current !== "object") return null;
    current = current[key];
  }
  const lastKey = path[path.length - 1]!;
  const parent = current;
  if (Array.isArray(parent)) {
    if (lastKey === "-") {
      if (op !== "add") return null;
      return { target: parent, key: parent.length, parent };
    }
    const idx = Number(lastKey);
    if (!Number.isNaN(idx) && idx >= 0 && idx < parent.length) {
      return { target: parent[idx], key: idx, parent };
    }
    return null;
  }
  if (typeof parent === "object" && parent !== null && lastKey in parent) {
    return { target: parent[lastKey], key: lastKey, parent };
  }
  return null;
}

function resolvePathOrCreate(doc: unknown, path: string[]): { target: any; key: string | number; parent: any } | null {
  if (path.length === 0) return null;
  let current: any = doc;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (current == null || typeof current !== "object") return null;
    if (current[key] === undefined) {
      const nextKey = path[i + 1]!;
      if (nextKey === "-" || Number(nextKey) >= 0) {
        current[key] = [];
      } else {
        current[key] = {};
      }
    }
    current = current[key];
  }
  const lastKey = path[path.length - 1]!;
  const parent = current;
  if (Array.isArray(parent)) {
    if (lastKey === "-") return { target: parent, key: parent.length, parent };
    const idx = Number(lastKey);
    if (!Number.isNaN(idx) && idx >= 0) {
      return { target: idx < parent.length ? parent[idx] : undefined, key: idx, parent };
    }
    return null;
  }
  return { target: parent[lastKey], key: lastKey, parent };
}

export interface PatchOp {
  op: string;
  path: string;
  value?: unknown;
  from?: string;
}

export function applyPatch(doc: Record<string, unknown>, ops: PatchOp[]): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(doc));

  for (const op of ops) {
    const pathSegments = op.path.split("/").filter(Boolean).map(unescapePointer);

    switch (op.op) {
      case "add": {
        const resolved = resolvePathOrCreate(result, pathSegments);
        if (!resolved) throw new PatchError(`add failed: invalid path "${op.path}"`);
        const { parent, key } = resolved;
        if (Array.isArray(parent) && key === parent.length) {
          parent.push(op.value);
        } else if (Array.isArray(parent)) {
          parent.splice(key as number, 0, op.value);
        } else {
          parent[key] = op.value;
        }
        break;
      }
      case "remove": {
        const resolved = resolvePath(result, pathSegments, "remove");
        if (!resolved) throw new PatchError(`remove failed: target not found "${op.path}"`);
        const { parent, key } = resolved;
        if (Array.isArray(parent)) {
          parent.splice(key as number, 1);
        } else {
          delete parent[key];
        }
        break;
      }
      case "replace": {
        const resolved = resolvePath(result, pathSegments, "replace");
        if (!resolved) throw new PatchError(`replace failed: target not found "${op.path}"`);
        const { parent, key } = resolved;
        parent[key] = op.value;
        break;
      }
      case "move": {
        if (!op.from) throw new PatchError("move requires 'from' field");
        const fromSegments = op.from.split("/").filter(Boolean).map(unescapePointer);
        const fromResolved = resolvePath(result, fromSegments, "move");
        if (!fromResolved) throw new PatchError(`move failed: source not found "${op.from}"`);
        const value = Array.isArray(fromResolved.parent)
          ? fromResolved.parent.splice(fromResolved.key as number, 1)[0]
          : (() => { const v = fromResolved.parent[fromResolved.key]; delete fromResolved.parent[fromResolved.key]; return v; })();

        const toSegments = pathSegments;
        const toResolved = resolvePathOrCreate(result, toSegments);
        if (!toResolved) throw new PatchError(`move failed: destination path invalid "${op.path}"`);
        const { parent: toParent, key: toKey } = toResolved;
        if (Array.isArray(toParent) && toKey === toParent.length) {
          toParent.push(value);
        } else if (Array.isArray(toParent)) {
          toParent.splice(toKey as number, 0, value);
        } else {
          toParent[toKey] = value;
        }
        break;
      }
      case "copy": {
        if (!op.from) throw new PatchError("copy requires 'from' field");
        const fromSegments = op.from.split("/").filter(Boolean).map(unescapePointer);
        const fromResolved = resolvePath(result, fromSegments, "copy");
        if (!fromResolved) throw new PatchError(`copy failed: source not found "${op.from}"`);
        const value = JSON.parse(JSON.stringify(fromResolved.target));

        const toSegments = pathSegments;
        const toResolved = resolvePathOrCreate(result, toSegments);
        if (!toResolved) throw new PatchError(`copy failed: destination path invalid "${op.path}"`);
        const { parent: toParent, key: toKey } = toResolved;
        if (Array.isArray(toParent) && toKey === toParent.length) {
          toParent.push(value);
        } else if (Array.isArray(toParent)) {
          toParent.splice(toKey as number, 0, value);
        } else {
          toParent[toKey] = value;
        }
        break;
      }
      case "test": {
        const resolved = resolvePath(result, pathSegments, "test");
        if (!resolved) throw new PatchError(`test failed: target not found "${op.path}"`);
        if (JSON.stringify(resolved.target) !== JSON.stringify(op.value)) {
          throw new PatchError(`test failed: value mismatch at "${op.path}"`);
        }
        break;
      }
      default:
        throw new PatchError(`unsupported operation: ${op.op}`);
    }
  }

  return result;
}
