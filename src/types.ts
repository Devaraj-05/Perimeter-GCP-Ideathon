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
