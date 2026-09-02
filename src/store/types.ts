import type { FhirResource, SearchFilter } from "../fhir/types.ts";

export interface VersionRecord {
  version_id: number;
  last_updated: string;
  data: string;
}

export interface SqlFilter {
  column: string;
  op: string;
  value: string;
}

export type FilterTranslator = (
  filters: SearchFilter[],
  searchParams: Map<string, { name: string; type: string }>
) => unknown;

export interface ResourceStore<F = SqlFilter[]> {
  create(resourceType: string, resource: FhirResource): FhirResource;
  read(resourceType: string, id: string): FhirResource | null;
  readVersion(resourceType: string, id: string, versionId: number): FhirResource | null;
  update(resourceType: string, id: string, resource: FhirResource, expectedVersion?: number): FhirResource;
  softDelete(resourceType: string, id: string): boolean;
  listVersions(resourceType: string, id: string): VersionRecord[];
  search(resourceType: string, filters: F, offset?: number, limit?: number): FhirResource[];
  count(resourceType: string, filters: F): number;
  transaction<T>(fn: () => T): T;
}

export interface StorageProvider<F = SqlFilter[]> {
  createStore(): ResourceStore<F> | Promise<ResourceStore<F>>;
  translateFilters: FilterTranslator;
}
