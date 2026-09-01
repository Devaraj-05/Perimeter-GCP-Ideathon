export type MoodType = 'Reflective' | 'Grateful' | 'Energized' | 'Stressed' | 'Curious' | 'Calm' | 'Determined' | 'Overwhelmed';

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
  mood: MoodType;
  mode: ReflectionMode;
  summary?: string;
  insights?: string[];
  tags?: string[];
  sentiment?: string;
  turns: TurnMessage[];
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
