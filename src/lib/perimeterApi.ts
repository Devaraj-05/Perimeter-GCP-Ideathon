import { apiFetch } from './apiClient';
import { Source, Artifact, IngestRunResult } from '../types';

/**
 * Client for the ingest gateway. Note there is no "write artifact" call:
 * artifacts are Admin-SDK-only (Amendment A.6), and Firestore rules deny
 * client writes to them outright.
 */

export async function listSources(): Promise<Source[]> {
  const { sources } = await apiFetch<{ sources: Source[] }>('/api/ingest/sources');
  return sources;
}

export async function addSource(ref: string): Promise<Source> {
  const { source } = await apiFetch<{ source: Source }>('/api/ingest/sources', {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
  return source;
}

export async function removeSource(sourceId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/ingest/sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
  });
}

export async function listArtifacts(): Promise<Artifact[]> {
  const { artifacts } = await apiFetch<{ artifacts: Artifact[] }>('/api/ingest/artifacts');
  return artifacts;
}

export async function runIngest(sourceId: string): Promise<IngestRunResult> {
  return apiFetch<IngestRunResult>('/api/ingest/run', {
    method: 'POST',
    body: JSON.stringify({ sourceId }),
  });
}
