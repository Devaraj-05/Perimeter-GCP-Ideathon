export type CategoryType = 'Personal' | 'Career & Ambition' | 'Mindfulness & Gratitude' | 'Ideas & Brainstorming' | 'Relationships' | 'Learning';

export type ReflectionMode = 'companion' | 'brainstorm' | 'socratic' | 'gratitude_wellness' | 'executive_summary';

/** What the user attached to a turn. Shown inside their own message. */
export interface TurnAttachment {
  id: string;
  title: string;
  kind: 'file' | 'link' | 'note' | 'repo';
}

/**
 * A deterministic finding, rendered as a message rather than a panel.
 *
 * Carried as STRUCTURE, not as a formatted string. The excerpts are attacker
 * text; interpolating them into markdown would let a document choose how its
 * own poisoning is displayed. The renderer emits them as plain React children,
 * exactly as the report panel did before it.
 */
export interface TurnFinding {
  title: string;
  verdict: 'clean' | 'suspicious' | 'hostile';
  matches: {
    signal: string;
    line: number;
    excerpt: string;
    hidden?: boolean;
  }[];
}

export interface TurnMessage {
  id: string;
  /**
   * 'perimeter' is us: text we wrote, from the deterministic scanner, never
   * from a model. It renders in the conversation like any other message so the
   * surface reads as a chat, and it is labelled so a reader can tell which
   * sentences the application stands behind and which a model produced from
   * attacker-influenced input.
   */
  role: 'user' | 'model' | 'perimeter';
  text: string;
  timestamp: string;
  modelUsed?: string;
  attachments?: TurnAttachment[];
  finding?: TurnFinding;
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
/** Where a match sits syntactically. Mirrors ContainmentKind in server/containment.ts. */
export type ContainmentKind =
  | 'none'
  | 'fenced_code'
  | 'inline_code'
  | 'blockquote'
  | 'quoted_span'
  | 'code_string'
  | 'code_comment';

/** How much a match matters. Mirrors FindingTier in server/triage.ts. */
export type FindingTier = 'live' | 'active' | 'quoted' | 'weak';

export interface Match {
  signal: string;
  /** Optional: only the repository scanner sets these. */
  containment?: ContainmentKind;
  tier?: FindingTier;
  start: number;
  end: number;
  /** 1-based. */
  line: number;
  excerpt: string;
  /** True when the matched characters are invisible and shown as code points. */
  hidden: boolean;
}
