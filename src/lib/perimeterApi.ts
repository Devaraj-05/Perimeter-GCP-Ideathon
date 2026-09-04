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

export interface LinkIngestResult {
  artifactId: string;
  segmentId: string;
  url: string;
  verdict: 'clean' | 'suspicious' | 'hostile';
  signals: string[];
  bytes: number;
  truncated: boolean;
}

/**
 * Fetches a pasted URL server-side and stores it as UNTRUSTED.
 *
 * The browser never makes the outbound request: doing it client-side would use
 * the user's own network as the proxy and skip every SSRF check.
 */
export async function ingestLink(url: string): Promise<LinkIngestResult> {
  return apiFetch<LinkIngestResult>('/api/ingest/link', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

// --- Pasted notes (Amendment F) ---

export interface NoteIngestResult {
  artifactId: string;
  segmentId: string;
  title: string;
  verdict: 'clean' | 'suspicious' | 'hostile';
  signals: string[];
  bytes: number;
}

/**
 * Stores pasted text as UNTRUSTED.
 *
 * Identical treatment to a fetched page — INV-14. Text a person pasted is not
 * more trustworthy than text we fetched, because the whole scenario is a person
 * pasting something someone else wrote.
 */
export async function ingestNote(text: string, label?: string): Promise<NoteIngestResult> {
  return apiFetch<NoteIngestResult>('/api/ingest/note', {
    method: 'POST',
    body: JSON.stringify({ text, label }),
  });
}

// --- Location (Amendment D) ---

export interface ResolvedLocation {
  placeName: string;
  lat: number;
  lng: number;
}

/**
 * Resolves coordinates or a typed place name to a place.
 *
 * The Maps key stays on the server (INV-12), which is why this is a round trip
 * rather than a browser SDK call.
 */
export async function resolveLocation(
  input: { lat: number; lng: number } | { query: string },
): Promise<ResolvedLocation> {
  const { location } = await apiFetch<{ location: ResolvedLocation }>('/api/location/resolve', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return location;
}
