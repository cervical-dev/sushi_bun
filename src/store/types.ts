import type { FhirResource, SearchFilter, SearchParamConfig } from "../fhir/types.ts";

export interface VersionRecord {
  version_id: number;
  last_updated: string;
  data: string;
}

export interface TypeHistoryRecord {
  id: string;
  resource_type: string;
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
  searchParams: Map<string, SearchParamConfig>
) => unknown;

export interface ResourceStore<F = SqlFilter[]> {
  create(resourceType: string, resource: FhirResource, id?: string): FhirResource;
  read(resourceType: string, id: string): FhirResource | null;
  readVersion(resourceType: string, id: string, versionId: number): FhirResource | null;
  update(resourceType: string, id: string, resource: FhirResource, expectedVersion?: number): FhirResource;
  softDelete(resourceType: string, id: string): boolean;
  exists(resourceType: string, id: string): boolean;
  isDeleted(resourceType: string, id: string): boolean;
  currentVersion(resourceType: string, id: string): { versionId: number; isDeleted: boolean } | null;
  listVersions(resourceType: string, id: string): VersionRecord[];
  listTypeHistory(resourceType: string, since?: string): TypeHistoryRecord[];
  listSystemHistory(since?: string): TypeHistoryRecord[];
  search(resourceType: string, filters: F, offset?: number, limit?: number): FhirResource[];
  count(resourceType: string, filters: F): number;
  transaction<T>(fn: () => T): T;
}

export interface StorageProvider<F = SqlFilter[]> {
  createStore(): ResourceStore<F> | Promise<ResourceStore<F>>;
  translateFilters: FilterTranslator;
}
