export type CategoryType = 'Personal' | 'Career & Ambition' | 'Mindfulness & Gratitude' | 'Ideas & Brainstorming' | 'Relationships' | 'Learning';

export type ReflectionMode = 'companion' | 'brainstorm' | 'socratic' | 'gratitude_wellness' | 'executive_summary';

export interface TurnMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  modelUsed?: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  title: string;
  content: string;
  category: CategoryType;
  mode: ReflectionMode;
  summary?: string;
  insights?: string[];
  tags?: string[];
  sentiment?: string;
  turns: TurnMessage[];
  /**
   * Where the entry was written (Amendment D). Optional: geolocation is denied
   * often, and a journal must never depend on it to save.
   *
   * placeName is DERIVED — it came from the Geocoding API, not from us — so it
   * renders through the INV-9 renderer like any other external-origin string.
   */
  location?: {
    placeName: string;
    lat: number;
    lng: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

// --- Perimeter: untrusted external content (Amendment A) ---

export type Verdict = 'clean' | 'suspicious' | 'hostile';
export type RunStatus = 'never' | 'ok' | 'error';

export interface Source {
  id: string;
  kind: 'github_repo';
  /** "owner/name" */
  ref: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  lastRunStatus: RunStatus;
  lastRunError: string | null;
  artifactCount: number;
}

export interface Artifact {
  id: string;
  sourceId: string;
  sourceRef: string;
  externalId: string;
  title: string;
  body: string;
  author: string;
  url: string;
  /** Immutable. No code path promotes an artifact to trusted. */
  trust: 'untrusted';
  threatScore: number;
  l1Score: number;
  l2Score: number | null;
  signals: string[];
  categories: string[];
  verdict: Verdict;
  classifierError: string | null;
  fetchedAt: string;
  externalUpdatedAt: string;
}

export interface IngestRunResult {
  ok: boolean;
  fetched: number;
  written: number;
  verdicts: Record<string, number>;
}

/**
 * Where a detection signal fired in a piece of untrusted content.
 *
 * Mirrors Match in server/detect.ts. The client does not import from server/,
 * so this is a hand-kept copy; `signal` is widened to string here because the
 * Signal union lives server-side and the UI only ever renders it.
 *
 * `excerpt` is attacker-authored text. It renders through UntrustedText and
 * never any other way (INV-9).
 */
export interface Match {
  signal: string;
  start: number;
  end: number;
  /** 1-based. */
  line: number;
  excerpt: string;
  /** True when the matched characters are invisible and shown as code points. */
  hidden: boolean;
}
