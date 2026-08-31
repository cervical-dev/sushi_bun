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
