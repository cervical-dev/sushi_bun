import type { FhirResource, SearchFilter, SearchParamConfig } from "../fhir/types.ts";

export interface VersionEntry {
  versionId: number;
  lastUpdated: string;
}

export interface HistoryEntry {
  id: string;
  resourceType: string;
  versionId: number;
  lastUpdated: string;
  resource: FhirResource;
}

export interface ResourceStore {
  create(resourceType: string, resource: FhirResource, id?: string): FhirResource;
  read(resourceType: string, id: string): FhirResource | null;
  readVersion(resourceType: string, id: string, versionId: number): FhirResource | null;
  update(resourceType: string, id: string, resource: FhirResource, expectedVersion?: number): FhirResource;
  softDelete(resourceType: string, id: string): boolean;
  exists(resourceType: string, id: string): boolean;
  isDeleted(resourceType: string, id: string): boolean;
  currentVersion(resourceType: string, id: string): { versionId: number; isDeleted: boolean } | null;
  listVersions(resourceType: string, id: string): VersionEntry[];
  listTypeHistory(resourceType: string, since?: string): HistoryEntry[];
  listSystemHistory(since?: string): HistoryEntry[];
  search(resourceType: string, filters: SearchFilter[], searchParams: Map<string, SearchParamConfig>, offset?: number, limit?: number): FhirResource[];
  count(resourceType: string, filters: SearchFilter[], searchParams: Map<string, SearchParamConfig>): number;
  transaction<T>(fn: () => T): T;
}

export interface StorageProvider {
  createStore(): ResourceStore | Promise<ResourceStore>;
}
