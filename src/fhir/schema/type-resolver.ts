import type { StructureDefinition, StructureDefinitionElement } from "../types.ts";

export function resolveStructureDefinition(
  sd: StructureDefinition,
  sdRegistry?: Map<string, StructureDefinition>
): StructureDefinition {
  if (!sd.baseDefinition || !sd.differential?.element || !sdRegistry) {
    return sd;
  }

  const baseSD = sdRegistry.get(sd.baseDefinition);
  if (!baseSD) {
    return sd;
  }

  const baseElements = baseSD.snapshot?.element ?? baseSD.differential?.element ?? [];
  const diffElements = sd.differential.element;

  const diffById = new Map<string, StructureDefinitionElement>();
  for (const el of diffElements) {
    diffById.set(el.id, el);
  }

  const merged: StructureDefinitionElement[] = [];
  const seenPaths = new Set<string>();

  for (const baseEl of baseElements) {
    const override = diffById.get(baseEl.id);
    if (override) {
      merged.push({ ...baseEl, ...override });
    } else {
      merged.push({ ...baseEl });
    }
    seenPaths.add(baseEl.id);
  }

  for (const diffEl of diffElements) {
    if (!seenPaths.has(diffEl.id)) {
      merged.push({ ...diffEl });
    }
  }

  return {
    ...sd,
    differential: { element: merged },
  };
}

export function buildElementIndex(
  elements: StructureDefinitionElement[]
): Map<string, StructureDefinitionElement> {
  const index = new Map<string, StructureDefinitionElement>();
  for (const el of elements) {
    index.set(el.path, el);
  }
  return index;
}
