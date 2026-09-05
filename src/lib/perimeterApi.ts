import { apiFetch, authedHeaders } from './apiClient';
import {
  Source,
  Artifact,
  IngestRunResult,
  Match,
  type FindingTier,
} from '../types';

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
  /** Optional so a response cached before this field existed cannot break the panel. */
  matches?: Match[];
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
  /** Optional so a response cached before this field existed cannot break the panel. */
  matches?: Match[];
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

// --- Files (Amendment G) ---

export interface FileIngestResult {
  artifactId: string;
  segmentId: string;
  title: string;
  kind: 'pdf' | 'image';
  verdict: 'clean' | 'suspicious' | 'hostile';
  /** Optional so a response cached before this field existed cannot break the panel. */
  matches?: Match[];
  signals: string[];
  bytes: number;
}

/** 5MB, matching the server. Checked here too so a huge file fails instantly. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Uploads a PDF or image and stores the text found in it as UNTRUSTED.
 *
 * The file itself is never stored anywhere (INV-15) — the server transcribes it
 * and drops the bytes. What comes back is a verdict on the text that was in it.
 */
export async function ingestFile(file: File): Promise<FileIngestResult> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That file is too large. The limit is 5MB.');
  }

  const buf = await file.arrayBuffer();
  // Chunked so a multi-megabyte file does not blow the argument limit of
  // String.fromCharCode via a single spread.
  const view = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }

  return apiFetch<FileIngestResult>('/api/ingest/file', {
    method: 'POST',
    body: JSON.stringify({ data: btoa(binary), filename: file.name }),
  });
}

// --- Gmail (Amendment H) ---

export interface GmailIngested {
  artifactId: string;
  title: string;
  verdict: 'clean' | 'suspicious' | 'hostile';
  /** Optional so a response cached before this field existed cannot break the panel. */
  matches?: Match[];
}

export async function gmailStatus(): Promise<boolean> {
  const { connected } = await apiFetch<{ connected: boolean }>('/api/gmail/status');
  return connected;
}

/** Returns Google's consent URL. The browser navigates there; we never see the token. */
export async function gmailConnectUrl(): Promise<string> {
  const { url } = await apiFetch<{ url: string }>('/api/gmail/connect', { method: 'POST' });
  return url;
}

export async function gmailDisconnect(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/gmail/disconnect', { method: 'POST' });
}

/** Pulls recent messages in as UNTRUSTED artifacts and returns their verdicts. */
export async function gmailIngest(max = 5): Promise<GmailIngested[]> {
  const { messages } = await apiFetch<{ messages: GmailIngested[] }>('/api/gmail/ingest', {
    method: 'POST',
    body: JSON.stringify({ max }),
  });
  return messages;
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

/** Where an agent would encounter a file. Mirrors FileRole in server/triage.ts. */
export type FileRole =
  | 'agent_instructions'
  | 'ci_config'
  | 'documentation'
  | 'test'
  | 'fixture'
  | 'source'
  | 'data'
  | 'other';

export type RepoVerdict = 'injection_found' | 'review' | 'discussion_only' | 'clean';

/** One finding: a file, its role, and every place a signal fired inside it. */
export interface RepoFinding {
  path: string;
  role: FileRole;
  /** The strongest tier among this file's matches. */
  tier: FindingTier;
  score: number;
  highConfidence: string[];
  matches: Match[];
  /** The file's markup does not close, so positions were not trusted. */
  structureUnreliable?: boolean;
}

export interface RepoScanResult {
  repo: string;
  defaultBranch: string;
  filesScanned: number;
  filesTotal: number;
  bytesScanned: number;
  stoppedBy: 'complete' | 'max_files' | 'max_bytes' | 'time' | 'rate_limit';
  /** The sentence the UI shows. Never phrased as a clean bill of health. */
  coverage: string;
  /**
   * What the scan concluded about injections — separate from coverage, which
   * is about how much was read. A scan stopped by a cap and finding nothing is
   * "nothing in what was read", never "clean".
   */
  verdict: RepoVerdict;
  headline: string;
  tierCounts: Record<FindingTier, number>;
  /** Conditions worth knowing that did not stop the scan, e.g. a rejected token. */
  warnings?: string[];
  findings: RepoFinding[];
}

export interface ScanProgress {
  scanned: number;
  total: number;
  path: string;
  findings: number;
  /** Surfaced separately so a real hit is visible the moment it lands. */
  live: number;
}

/**
 * Scans a public repository for prompt injections — INV-18.
 *
 * Nothing here reaches a model. The server fetches the tree, matches each file
 * against the deterministic patterns, and streams back spans. It cannot
 * summarise the repository and is not meant to.
 *
 * The response is NDJSON — one JSON object per line — so progress arrives while
 * the scan runs instead of after it. Read with fetch and a stream reader rather
 * than EventSource, because EventSource cannot set an Authorization header and
 * the workaround is putting a credential in a URL.
 *
 * No client timeout: a 500-file scan legitimately takes longer than a normal
 * request, and the server's own wall-clock cap is what bounds it.
 */
export async function scanRepository(
  repo: string,
  onProgress?: (p: ScanProgress) => void,
): Promise<RepoScanResult> {
  const res = await fetch('/api/ingest/repo-scan', {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify({ repo }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'That repository could not be scanned.');
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('That repository could not be scanned.');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: RepoScanResult | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Keep the trailing fragment: a chunk boundary can fall mid-line.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === 'progress') onProgress?.(event as ScanProgress);
      else if (event.type === 'result') result = event as RepoScanResult;
      else if (event.type === 'error') throw new Error(event.error);
    }
  }

  if (!result) throw new Error('The scan ended without a result. Please retry.');
  return result;
}
