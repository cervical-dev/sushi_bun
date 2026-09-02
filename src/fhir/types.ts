export interface Meta {
  versionId?: string;
  lastUpdated?: string;
  profile?: string[];
}

export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: Meta;
  [key: string]: unknown;
}

export interface OperationOutcome extends FhirResource {
  resourceType: "OperationOutcome";
  issue: OperationOutcomeIssue[];
}

export interface OperationOutcomeIssue {
  severity: "fatal" | "error" | "warning" | "information";
  code: string;
  diagnostics?: string;
  details?: { coding?: { system: string; code: string }[] };
  location?: string[];
  expression?: string[];
}

export interface Bundle extends FhirResource {
  resourceType: "Bundle";
  type: string;
  total?: number;
  entry?: BundleEntry[];
  link?: BundleLink[];
}

export interface BundleEntry {
  fullUrl?: string;
  resource?: FhirResource;
  request?: { method: string; url: string };
  response?: { status: string; location?: string; etag?: string; outcome?: FhirResource };
}

export interface BundleLink {
  relation: string;
  url: string;
}

export interface ResourceConfig {
  type: string;
  interactions: Set<string>;
  searchParams: Map<string, SearchParamConfig>;
  operations: OperationConfig[];
  versioning: string;
  readHistory: boolean;
  updateCreate: boolean;
  conditionalCreate: boolean;
  conditionalRead: string;
  conditionalUpdate: boolean;
  conditionalDelete: string;
}

export interface OperationConfig {
  name: string;
  definition: string;
}

export interface SearchParamConfig {
  name: string;
  type: string;
  documentation?: string;
}

export interface RouteConfig {
  resources: Map<string, ResourceConfig>;
  systemInteractions: Set<string>;
}

export interface SearchFilter {
  parameter: string;
  prefix?: string;
  value: string;
  modifier?: string;
}

export interface PaginatedSearchResult {
  bundle: Bundle;
  total: number;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "information";
  code: string;
  diagnostics: string;
  location?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ElementBinding {
  strength: "required" | "extensible" | "preferred" | "example";
  valueSet?: string;
}

export interface ElementConstraint {
  key: string;
  severity: "error" | "warning";
  human?: string;
  expression: string;
}

export interface ElementSlicingDiscriminator {
  type: "value" | "exists" | "pattern" | "type" | "profile";
  path: string;
}

export interface ElementSlicing {
  discriminator: ElementSlicingDiscriminator[];
  rules: "closed" | "open" | "openAtEnd";
  description?: string;
}

export interface StructureDefinitionElement {
  id: string;
  path: string;
  min?: number;
  max?: string;
  mustSupport?: boolean;
  type?: Array<{ code: string; targetProfile?: string[] }>;
  fixedCode?: string;
  fixedBoolean?: boolean;
  fixedString?: string;
  fixedUri?: string;
  fixedId?: string;
  patternCodeableConcept?: unknown;
  binding?: ElementBinding;
  constraint?: ElementConstraint[];
  slicing?: ElementSlicing;
  sliceName?: string;
  definition?: string;
  comment?: string;
  short?: string;
}

export interface StructureDefinition {
  resourceType: "StructureDefinition";
  id: string;
  url: string;
  type: string;
  baseDefinition?: string;
  differential?: {
    element: StructureDefinitionElement[];
  };
  snapshot?: {
    element: StructureDefinitionElement[];
  };
}

export function getProfileUrl(resource: Record<string, unknown>): string | undefined {
  const meta = resource.meta;
  if (meta && typeof meta === "object") {
    const profile = (meta as Record<string, unknown>).profile;
    if (Array.isArray(profile) && profile.length > 0) {
      return profile[0] as string;
    }
  }
  return undefined;
}
