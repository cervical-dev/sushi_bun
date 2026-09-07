import type { SearchParamConfig } from "./types.ts";

export interface SearchParameterResource {
  resourceType?: string;
  url: string;
  name: string;
  code: string;
  type: string;
  expression?: string;
  extension?: Array<{ url: string; valueBoolean?: boolean; valueString?: string }>;
}

export function expressionToJsonPath(expression: string, fallbackName?: string): string {
  if (!expression || !expression.includes(".")) {
    return `$.${fallbackName ?? "unknown"}`;
  }

  const dotIndex = expression.indexOf(".");
  const rest = expression.slice(dotIndex + 1);
  const segments = rest.split(".");

  if (segments.length === 1) {
    return `$.${segments[0]}`;
  }

  return `$.${segments.join(".")}`;
}

const CODEABLE_CONCEPT_FIELDS = new Set([
  "code", "reasonCode", "method", "category", "partOf",
  "diagnosis", "procedure", "outcome", "assessment",
]);

const IDENTIFIER_FIELDS = new Set(["identifier"]);

export function deriveSearchPath(expression: string, type: string): string {
  if (!expression || !expression.includes(".")) {
    return `$.${expression || "unknown"}`;
  }

  const dotIndex = expression.indexOf(".");
  const rest = expression.slice(dotIndex + 1);
  const segments = rest.split(".");
  const lastSegment = segments[segments.length - 1]!;

  if (type === "token") {
    if (CODEABLE_CONCEPT_FIELDS.has(lastSegment)) {
      return segments.length === 1
        ? `$.${lastSegment}.coding`
        : `$.${segments.slice(0, -1).join(".")}[*].${lastSegment}.coding`;
    }
    if (IDENTIFIER_FIELDS.has(lastSegment)) {
      return segments.length === 1
        ? `$.${lastSegment}`
        : `$.${segments.slice(0, -1).join(".")}[*].${lastSegment}`;
    }
    return `$.${rest}`;
  }

  if (type === "reference") {
    if (rest.endsWith(".reference")) {
      return `$.${rest}`;
    }
    return `$.${rest}.reference`;
  }

  return `$.${rest}`;
}

export interface ResolvedParam {
  jsonPath: string;
  searchPath: string;
}

export function resolveSearchParamMapping(
  searchParams: Map<string, SearchParamConfig>,
  searchParameterResources: SearchParameterResource[]
): Map<string, ResolvedParam> {
  const spByCode = new Map<string, SearchParameterResource>();
  for (const sp of searchParameterResources) {
    const existing = spByCode.get(sp.code);
    if (existing && existing.url !== sp.url) {
      console.warn(`SearchParameter collision: code "${sp.code}" maps to both ${existing.url} and ${sp.url}. Using ${sp.url}.`);
    }
    spByCode.set(sp.code, sp);
  }

  const mapping = new Map<string, ResolvedParam>();

  for (const [name, config] of searchParams) {
    const sp = spByCode.get(name);
    const expression = sp?.expression;
    const jsonPath = expressionToJsonPath(expression ?? "", name);
    const searchPath = deriveSearchPath(expression ?? name, config.type);
    mapping.set(name, { jsonPath, searchPath });
  }

  return mapping;
}
