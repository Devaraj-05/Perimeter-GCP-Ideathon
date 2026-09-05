import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  Save,
  Download,
  Trash2,
  Mic,
  MicOff,
  Check,
  AlertCircle,
  Lightbulb,
  HelpCircle,
  Heart,
  FileText,
  Copy,
  ChevronDown,
  RefreshCw,
  Tag,
  Smile,
  Github,
  ShieldAlert,
  Swords,
  MapPin,
  X,
  Paperclip,
  Link2,
  ClipboardPaste,
  FileUp,
  Mail,
  Plus,
  Globe,
} from 'lucide-react';
import {
  JournalEntry,
  TurnMessage,
  CategoryType,
  ReflectionMode,
  Match,
} from '../types';
import { requestSummary } from '../lib/geminiApi';
import { reflectGrounded } from '../lib/reflect';
import {
  resolveLocation,
  ingestNote,
  ingestLink,
  ingestFile,
  gmailStatus,
  gmailConnectUrl,
  gmailIngest,
  scanRepository,
  githubStatus,
  githubConnectUrl,
  type RepoScanResult,
  type ScanProgress,
} from '../lib/perimeterApi';
import { extractUrls, mentionsUrl } from '../lib/urls';
import { ThreatEvent } from '../lib/agentApi';
import { InjectionReport } from './InjectionReport';
import { RepoScanReport } from './RepoScanReport';
import { UntrustedText } from './UntrustedText';

interface JournalEditorProps {
  entry: JournalEntry;
  onSave: (updatedEntry: JournalEntry) => Promise<void>;
  /** Artifact ids available to ground reflections. Empty = no sources connected. */
  groundingArtifactIds: string[];
  onDelete?: (entryId: string) => void;
  isSaving: boolean;
  saveError: string | null;
  lastSavedAt: string | null;
  /**
   * True when this account has no saved entries yet.
   *
   * Drives the one-time orientation banner below. Without it a first-time
   * visitor sees categories and modes and concludes this is a chat app — the entire
   * reason the project exists is behind navigation they have no reason to
   * touch.
   */
  isFirstRun?: boolean;
  onOpenRedTeam?: () => void;
  /**
   * Called after content is attached, so the app can refresh grounding.
   *
   * Attaching does not touch the airlock: it adds an artifact, grounding picks
   * it up, and grounding already routes the turn through the toolless Reader
   * (src/lib/reflect.ts). This is an entry point, not a code path.
   */
  onAttached?: () => void;
}

const CATEGORIES: CategoryType[] = [
  'Personal',
  'Career & Ambition',
  'Mindfulness & Gratitude',
  'Ideas & Brainstorming',
  'Relationships',
  'Learning',
];

const MODES: {
  id: ReflectionMode;
  name: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'companion',
    name: 'Thought Companion',
    desc: 'Empathetic feedback & gentle reframing',
    icon: Heart,
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm & Ideas',
    desc: 'Actionable solutions & creative angles',
    icon: Lightbulb,
  },
  {
    id: 'socratic',
    name: 'Socratic Inquiry',
    desc: 'Deep probing questions to test assumptions',
    icon: HelpCircle,
  },
  {
    id: 'gratitude_wellness',
    name: 'Mindfulness & Grounding',
    desc: 'Highlighting micro-wins & calming perspective',
    icon: Sparkles,
  },
  {
    id: 'executive_summary',
    name: 'Executive Synthesis',
    desc: 'Concise summary & key takeaway bullet points',
    icon: FileText,
  },
];

export const JournalEditor: React.FC<JournalEditorProps> = ({
  entry,
  onSave,
  groundingArtifactIds,
  onDelete,
  isSaving,
  saveError,
  lastSavedAt,
  isFirstRun = false,
  onOpenRedTeam,
  onAttached,
}) => {
  // Local state initialized from entry
  const [title, setTitle] = useState(entry.title || '');
  const [content, setContent] = useState(entry.content || '');
  const [category, setCategory] = useState<CategoryType>(entry.category || 'Personal');
  const [mode, setMode] = useState<ReflectionMode>(entry.mode || 'companion');
  const [turns, setTurns] = useState<TurnMessage[]>(entry.turns || []);
  const [summary, setSummary] = useState<string | undefined>(entry.summary);
  const [location, setLocation] = useState(entry.location);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Attachments (Amendment F). Chips are local display state; the artifacts
  // themselves live server-side and drive grounding.
  const [attachMenu, setAttachMenu] = useState<null | 'note' | 'link'>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  /**
   * When on, links in a message YOU type are fetched and read.
   *
   * Off by default: fetching is an outbound request made on your behalf, and
   * that should be something you switch on deliberately rather than a
   * behaviour you discover.
   */
  const [webSearch, setWebSearch] = useState(false);

  /**
   * When you paste something large or a link into the chat, we offer to run it
   * through the perimeter instead of trusting it.
   *
   * This is the honest resolution of "why can't I just paste?". You can — but
   * pasted text defaults to trusted (it goes to the tool-holding Planner), and
   * a poisoned email pasted into chat would sail straight past the perimeter.
   * So on a paste that looks like outside content, we ask. One tap re-routes it
   * to the Reader as UNTRUSTED; ignore it and it stays your own words.
   */
  const [pasteOffer, setPasteOffer] = useState<{ kind: 'link' | 'note'; text: string } | null>(null);
  const [attachDraft, setAttachDraft] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<
    {
      id: string;
      title: string;
      verdict: 'clean' | 'suspicious' | 'hostile';
      /** Where each signal fired. Empty is a real answer: nothing matched. */
      matches: Match[];
    }[]
  >([]);
  /** Which attachment's evidence panel is open, if any. */
  const [reportFor, setReportFor] = useState<string | null>(null);
  /** A repository scan in flight, and its result. Never persisted (INV-18). */
  const [repoPrompt, setRepoPrompt] = useState(false);
  const [repoRef, setRepoRef] = useState('');
  const [repoScanning, setRepoScanning] = useState(false);
  const [repoResult, setRepoResult] = useState<RepoScanResult | null>(null);
  /** Live scan progress. A tree walk takes tens of seconds; a bare spinner reads as a hang. */
  const [repoProgress, setRepoProgress] = useState<ScanProgress | null>(null);
  /** Whether this account has a GitHub connection — Amendment J. */
  const [githubConnected, setGithubConnected] = useState(false);
  const [insights, setInsights] = useState<string[] | undefined>(entry.insights);
  const [tags, setTags] = useState<string[] | undefined>(entry.tags);
  const [sentiment, setSentiment] = useState<string | undefined>(entry.sentiment);

  // Interaction state
  const [followUpInput, setFollowUpInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastTurnEvents, setLastTurnEvents] = useState<ThreatEvent[]>([]);
  const [lastTurnTainted, setLastTurnTainted] = useState(false);

  const turnsEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Sync state when active entry prop changes
  useEffect(() => {
    setTitle(entry.title || '');
    setContent(entry.content || '');
    setCategory(entry.category || 'Personal');
    setLocation(entry.location);
    setLocationError(null);
    titledRef.current = false;
    setMode(entry.mode || 'companion');
    setTurns(entry.turns || []);
    setSummary(entry.summary);
    setInsights(entry.insights);
    setTags(entry.tags);
    setSentiment(entry.sentiment);
    setHasUnsavedChanges(false);
    setErrorMsg(null);
    setLastTurnEvents([]);
    setLastTurnTainted(false);
  }, [entry.id]);

  // Scroll to bottom of conversation turns
  useEffect(() => {
    if (turns.length > 0) {
      turnsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [turns.length, isGenerating]);

  // Speech to text setup
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }
        if (transcript) {
          setContent((prev) => {
            const next = prev ? `${prev}\n${transcript.trim()}` : transcript.trim();
            setHasUnsavedChanges(true);
            return next;
          });
        }
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition error:', e);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleSpeech = () => {
    if (!recognitionRef.current) {
      alert('Speech Recognition is not supported by your browser.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error('Speech start error:', err);
      }
    }
  };

  /**
   * Attaches the place this entry was written (Amendment D).
   *
   * Geolocation is denied far more often than it is granted, so a denial is a
   * normal outcome and offers the typed fallback rather than an error. Saving
   * never depends on this succeeding.
   */
  const attachLocation = async () => {
    setLocationError(null);
    setLocating(true);
    try {
      const coords = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!('geolocation' in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          () => resolve(null),
          { timeout: 8000, maximumAge: 300_000 },
        );
      });

      if (!coords) {
        setLocationError('Location unavailable. Type a place name instead.');
        return;
      }

      const resolved = await resolveLocation({
        lat: coords.coords.latitude,
        lng: coords.coords.longitude,
      });
      setLocation(resolved);
      setHasUnsavedChanges(true);
    } catch (err: any) {
      setLocationError(err?.message || 'Could not resolve that location.');
    } finally {
      setLocating(false);
    }
  };

  const attachTypedPlace = async (query: string) => {
    if (!query.trim()) return;
    setLocationError(null);
    setLocating(true);
    try {
      setLocation(await resolveLocation({ query }));
      setHasUnsavedChanges(true);
    } catch (err: any) {
      setLocationError(err?.message || 'Could not find that place.');
    } finally {
      setLocating(false);
    }
  };

  /**
   * Attaches pasted text or a link as UNTRUSTED content (Amendment F).
   *
   * The verdict comes back from the server's own screening; the chip shows it
   * so a user can see that something they pasted was flagged hostile BEFORE
   * they ask a question about it.
   */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Uploads a PDF or image (Amendment G).
   *
   * The bytes are transcribed server-side and discarded; only the text found
   * in the file is kept. An instruction hidden in an image is invisible to
   * every text filter we have, so the verdict on that chip is often the first
   * time anyone sees it.
   */
  const submitFile = async (file: File) => {
    setAttaching(true);
    setAttachError(null);
    try {
      const r = await ingestFile(file);
      setAttachments((prev) => [
        ...prev,
        { id: r.artifactId, title: r.title, verdict: r.verdict, matches: r.matches ?? [] },
      ]);
      onAttached?.();
    } catch (err: any) {
      setAttachError(err?.message || 'Could not read that file.');
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * Connects a mailbox, or reads from a connected one (Amendment H).
   *
   * Status is checked on click rather than on mount: most sessions never touch
   * email, and an extra request on every page load to answer a question nobody
   * asked is a poor trade.
   */
  const handleMail = async () => {
    setAttaching(true);
    setAttachError(null);
    try {
      if (!(await gmailStatus())) {
        // The consent happens on Google's domain. We never see the password,
        // and the token never reaches this browser (INV-16).
        window.open(await gmailConnectUrl(), '_blank', 'noopener,noreferrer');
        setAttachError('Finish connecting in the new tab, then press this again.');
        return;
      }

      const messages = await gmailIngest(5);
      if (messages.length === 0) {
        setAttachError('No recent messages found.');
        return;
      }
      setAttachments((prev) => [
        ...prev,
        ...messages.map((m) => ({
          id: m.artifactId,
          title: m.title,
          verdict: m.verdict,
          matches: m.matches ?? [],
        })),
      ]);
      onAttached?.();
    } catch (err: any) {
      setAttachError(err?.message || 'Could not reach your mailbox.');
    } finally {
      setAttaching(false);
    }
  };

  /**
   * Decides whether a paste looks like something from outside worth checking.
   * A short question typed-then-pasted should not nag; a URL or a big block
   * should offer the boundary.
   */
  const onComposerPaste = (clipboard: string) => {
    // Named for what it is. urls.test.ts asserts extractUrls is only ever
    // called on user-authored input, and a call site called `text` tells a
    // reviewer nothing about whose text it is.
    const pastedByUser = clipboard.trim();
    if (!pastedByUser) return;
    const urls = extractUrls(pastedByUser);
    if (urls.length === 1 && pastedByUser.length <= urls[0].length + 4) {
      setPasteOffer({ kind: 'link', text: urls[0] });
    } else if (pastedByUser.length >= 240) {
      setPasteOffer({ kind: 'note', text: pastedByUser });
    }
  };

  /** Re-routes the pasted content through the perimeter and clears it from the box. */
  const acceptPasteOffer = async () => {
    if (!pasteOffer) return;
    const offer = pasteOffer;
    setPasteOffer(null);
    setAttaching(true);
    setAttachError(null);
    try {
      const r =
        offer.kind === 'link' ? await ingestLink(offer.text) : await ingestNote(offer.text);
      setAttachments((prev) => [
        ...prev,
        {
          id: r.artifactId,
          title: offer.kind === 'link' ? (r as any).url ?? offer.text : (r as any).title ?? 'Pasted text',
          verdict: r.verdict,
          matches: r.matches ?? [],
        },
      ]);
      // It is an attachment now, not a chat message: take it out of the box.
      setFollowUpInput((prev) => prev.split(offer.text).join('').trim());
      onAttached?.();
    } catch (err: any) {
      setAttachError(err?.message || 'Could not check that.');
    } finally {
      setAttaching(false);
    }
  };

  const submitAttachment = async () => {
    const value = attachDraft.trim();
    if (!value || !attachMenu) return;

    setAttaching(true);
    setAttachError(null);
    try {
      const r =
        attachMenu === 'link'
          ? await ingestLink(value)
          : await ingestNote(value);

      setAttachments((prev) => [
        ...prev,
        {
          id: r.artifactId,
          title: attachMenu === 'link' ? (r as any).url ?? value : (r as any).title ?? 'Pasted note',
          verdict: r.verdict,
          matches: r.matches ?? [],
        },
      ]);
      setAttachDraft('');
      setAttachMenu(null);
      // Grounding is what actually routes the next turn through the airlock.
      onAttached?.();
    } catch (err: any) {
      setAttachError(err?.message || 'Could not attach that.');
    } finally {
      setAttaching(false);
    }
  };

  // Helper to compile current entry object
  const getCurrentEntryObject = (): JournalEntry => ({
    ...entry,
    title: title.trim() || 'Untitled Reflection',
    content,
    category,
    mode,
    turns,
    summary,
    insights,
    tags,
    sentiment,
    location,
    updatedAt: new Date().toISOString(),
  });

  // Handle Save
  /** Guards against firing the title request more than once per entry. */
  const titledRef = useRef(false);

  /**
   * Names an entry from its content, once.
   *
   * A history list showing "CANDIDATE PROFILE Name: Alex Morgan Position:..."
   * is unreadable — the first 60 characters of a pasted document say nothing
   * about what the conversation was. The summarise endpoint already returns a
   * 3-6 word title; it was only ever wired to the Insights button, so titles
   * appeared only if the user happened to press it.
   *
   * Fires in the background and fails silently: a missing title is a cosmetic
   * problem and must never block a save or surface an error.
   */
  const autoTitle = async (saved: JournalEntry) => {
    if (titledRef.current) return;
    const current = (saved.title || '').trim();
    if (current && current !== 'Untitled Reflection') return;
    if (!saved.content.trim() && saved.turns.length === 0) return;

    titledRef.current = true;
    try {
      const result = await requestSummary({ content: saved.content, turns: saved.turns });
      const generated = (result.title || '').trim();
      // The Insights modal and the Synthesis card used to depend on a button
      // the user had to press. With that button gone, this one call — already
      // being made for the title — populates all of it, so synthesis appears on
      // its own after the first exchange.
      if (result.summary) setSummary(result.summary);
      if (result.insights?.length) setInsights(result.insights);
      if (result.tags?.length) setTags(result.tags);
      if (result.sentiment) setSentiment(result.sentiment);
      if (generated) setTitle(generated);

      await onSave({
        ...saved,
        title: generated || saved.title,
        summary: result.summary,
        insights: result.insights,
        tags: result.tags,
        sentiment: result.sentiment,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Leave it untitled; the user can rename it from the history menu.
      titledRef.current = false;
    }
  };

  const handleSave = async () => {
    setErrorMsg(null);
    try {
      const updated = getCurrentEntryObject();
      await onSave(updated);
      setHasUnsavedChanges(false);
      void autoTitle(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save reflection to Firestore.');
    }
  };

  // Handle Initial Reflection with Gemini
  const handleReflectWithGemini = async () => {
    if (!content.trim() && turns.length === 0) {
      setErrorMsg('Please write something in your journal entry before reflecting.');
      return;
    }
    setErrorMsg(null);
    setIsGenerating(true);

    try {
      const userPrompt = content.trim();
      const updatedTurns: TurnMessage[] = [
        ...turns,
        {
          id: `msg-${Date.now()}-u`,
          role: 'user',
          text: userPrompt || 'Please reflect on my journal context.',
          timestamp: new Date().toISOString(),
        },
      ];

      setTurns(updatedTurns);
      setHasUnsavedChanges(true);

      const response = await reflectGrounded({
        content: userPrompt,
        mode,
        category,
        turns: updatedTurns,
        groundingArtifactIds,
      });
      setLastTurnEvents(response.threatEvents);
      setLastTurnTainted(response.turnTaint);

      const modelTurn: TurnMessage = {
        id: `msg-${Date.now()}-m`,
        role: 'model',
        text: response.reply,
        timestamp: response.timestamp,
        modelUsed: response.modelUsed,
      };

      const finalTurns = [...updatedTurns, modelTurn];
      setTurns(finalTurns);

      // Auto-save to Firestore immediately
      const updated = {
        ...getCurrentEntryObject(),
        turns: finalTurns,
      };
      await onSave(updated);
      setHasUnsavedChanges(false);
      // Name and synthesise the entry from the exchange, once. The chat is now
      // the only input, so this is where an entry earns its title.
      void autoTitle(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gemini reflection request failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    githubStatus()
      .then((s) => setGithubConnected(s.connected))
      .catch(() => setGithubConnected(false));
  }, []);

  /**
   * Connects a GitHub account — Amendment J.
   *
   * Opens GitHub's own consent screen. The credential is exchanged server-side
   * and sealed there; the browser never sees it (INV-16).
   */
  const connectGithub = async () => {
    setAttachError(null);
    try {
      window.location.href = await githubConnectUrl();
    } catch (err: any) {
      setAttachError(err?.message ?? 'Could not start the GitHub connection.');
    }
  };

  /**
   * Scans a public repository for prompt injections — INV-18.
   *
   * The question is fixed and there is only one of it: where are the
   * injections. No model runs anywhere in this path, on the server or here,
   * which is what makes the scanner itself impossible to hijack. It is also
   * why there is deliberately no "summarise this repo" button beside it.
   */
  const runRepoScan = async () => {
    // Accepts a full URL or just owner/name. Plain string work rather than
    // regexes: the server validates the result with isValidRepoRef anyway,
    // and this is the tidying, not the check.
    let ref = repoRef.trim();
    for (const prefix of ['https://github.com/', 'http://github.com/', 'github.com/']) {
      if (ref.toLowerCase().startsWith(prefix)) {
        ref = ref.slice(prefix.length);
        break;
      }
    }
    if (ref.toLowerCase().endsWith('.git')) ref = ref.slice(0, -4);
    while (ref.endsWith('/')) ref = ref.slice(0, -1);

    if (!ref || repoScanning) return;

    setRepoScanning(true);
    setAttachError(null);
    setRepoResult(null);
    setRepoProgress(null);
    try {
      setRepoResult(await scanRepository(ref, setRepoProgress));
      setRepoPrompt(false);
    } catch (err: any) {
      setAttachError(err?.message ?? 'That repository could not be scanned.');
    } finally {
      setRepoScanning(false);
      setRepoProgress(null);
    }
  };

  /**
   * Fetches and screens every URL in a piece of text the USER typed.
   *
   * One path, called from the send handler and from the explicit "Fetch and
   * screen this link" button. Two fetch paths would be two places to get
   * INV-11 wrong.
   *
   * extractUrls is applied only to text the user typed — never to a turn, an
   * artifact or an attachment. A link inside untrusted content is an attacker
   * choosing what our server requests, and following one would hand them a
   * fetch primitive aimed wherever they like.
   *
   * The browser never touches these URLs. The server fetches them under
   * INV-11: HTTPS only, resolved addresses checked against private ranges,
   * redirects revalidated per hop.
   */
  const fetchAndScreenUrls = async (userTypedText: string): Promise<string[]> => {
    const added: string[] = [];

    for (const url of extractUrls(userTypedText)) {
      try {
        const r = await ingestLink(url);
        added.push(r.artifactId);
        setAttachments((prev) => [
          ...prev,
          { id: r.artifactId, title: r.url ?? url, verdict: r.verdict, matches: r.matches ?? [] },
        ]);
      } catch (err: any) {
        // A refused link is information, not a failure: the guard saying no is
        // the feature. Say so and carry on with the remaining links.
        setAttachError(err?.message || `Could not read ${url}`);
      }
    }

    if (added.length > 0) onAttached?.();
    return added;
  };

  /**
   * Screens a pasted link on demand, with no message attached.
   *
   * Until now the Web toggle only ever fetched links found in a message being
   * sent, so pasting a URL and asking nothing did nothing at all. Reading a
   * link is a thing a user wants to do on its own.
   */
  const screenPastedLinks = async () => {
    if (isGenerating) return;
    setAttachError(null);
    const consumed = extractUrls(followUpInput);
    if (consumed.length === 0) return;
    await fetchAndScreenUrls(followUpInput);
    // The links are attachments now, not a half-written message.
    setFollowUpInput((prev) =>
      consumed.reduce((acc, url) => acc.split(url).join(''), prev).trim(),
    );
  };

  /**
   * "What's in it" — the ONLY one of the two chip buttons that runs a model.
   *
   * The question is a fixed literal. A model that has just read a poisoned
   * document must never get to compose the question we put to the user, so the
   * text is ours and only the answer is the model's. The answer still arrives
   * through the airlock: the Reader holds no tools, and the turn is tainted
   * because an artifact contributed to it.
   */
  const summariseAttachment = (artifactId: string) =>
    handleSendFollowUp(undefined, {
      text: 'What is in this document? Describe what it says.',
      grounding: [artifactId],
    });

  // Handle Follow-up in Multi-Turn dialogue
  /**
   * @param override Supplied by the "What's in it" button: a fixed question and
   * one artifact to ground it on. It exists so that button reuses this exact
   * path — the same Reader, the same broker, the same log — rather than a
   * second route to the Planner that could drift out of step with this one.
   */
  const handleSendFollowUp = async (
    e?: React.FormEvent,
    override?: { text: string; grounding: string[] },
  ) => {
    if (e) e.preventDefault();
    const followUpText = override?.text ?? followUpInput.trim();
    if (!followUpText || isGenerating) return;

    if (!override) setFollowUpInput('');
    setErrorMsg(null);
    setIsGenerating(true);

    try {
      const updatedTurns: TurnMessage[] = [
        ...turns,
        {
          id: `msg-${Date.now()}-u`,
          role: 'user',
          text: followUpText,
          timestamp: new Date().toISOString(),
        },
      ];

      setTurns(updatedTurns);
      setHasUnsavedChanges(true);

      // Web search — links in YOUR message only.
      //
      // extractUrls is deliberately never applied to a turn, an artifact or an
      // attachment. A link inside untrusted content is an attacker choosing
      // what our server requests, and following one would hand them a fetch
      // primitive aimed wherever they like.
      const extraGrounding = webSearch ? await fetchAndScreenUrls(followUpText) : [];

      const response = await reflectGrounded({
        content: content.trim(),
        mode,
        category,
        turns: updatedTurns,
        // Newly fetched ids are merged here rather than waiting for the parent
        // to refresh: the prop would still be stale on this turn.
        groundingArtifactIds: [
          ...groundingArtifactIds,
          ...extraGrounding,
          ...(override?.grounding ?? []),
        ],
      });
      setLastTurnEvents(response.threatEvents);
      setLastTurnTainted(response.turnTaint);

      const modelTurn: TurnMessage = {
        id: `msg-${Date.now()}-m`,
        role: 'model',
        text: response.reply,
        timestamp: response.timestamp,
        modelUsed: response.modelUsed,
      };

      const finalTurns = [...updatedTurns, modelTurn];
      setTurns(finalTurns);

      // Auto-save
      const updated = {
        ...getCurrentEntryObject(),
        turns: finalTurns,
      };
      await onSave(updated);
      setHasUnsavedChanges(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to send message to Gemini.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Auto-Summarize & Insights Extraction
  const handleGenerateSummary = async () => {
    if (!content.trim() && turns.length === 0) {
      setErrorMsg('Add thoughts or dialogue before generating summary.');
      return;
    }
    setErrorMsg(null);
    setIsSummarizing(true);

    try {
      const result = await requestSummary({
        content,
        turns,
      });

      if (!title || title === 'Untitled Reflection') {
        if (result.title) setTitle(result.title);
      }
      if (result.summary) setSummary(result.summary);
      if (result.insights && result.insights.length > 0) setInsights(result.insights);
      if (result.tags && result.tags.length > 0) setTags(result.tags);
      if (result.sentiment) setSentiment(result.sentiment);

      setHasUnsavedChanges(true);

      const updated = {
        ...getCurrentEntryObject(),
        title: title || result.title || 'Untitled Reflection',
        summary: result.summary,
        insights: result.insights,
        tags: result.tags,
        sentiment: result.sentiment,
      };

      await onSave(updated);
      setHasUnsavedChanges(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to synthesize summary.');
    } finally {
      setIsSummarizing(false);
    }
  };

  // Export entry to markdown file
  const handleExportMarkdown = () => {
    const lines = [
      `# ${title || 'Journal Reflection'}`,
      `**Date:** ${new Date(entry.createdAt).toLocaleDateString()} | **Category:** ${category}` +
        (location ? ` | **Place:** ${location.placeName}` : ''),
      '',
      `## Journal Entry`,
      content || '_No initial text written._',
      '',
    ];

    if (summary) {
      lines.push(`## Gemini Synthesis`);
      lines.push(summary);
      lines.push('');
    }

    if (insights && insights.length > 0) {
      lines.push(`### Key Actionable Takeaways`);
      insights.forEach((ins) => lines.push(`- ${ins}`));
      lines.push('');
    }

    if (turns.length > 0) {
      lines.push(`## Multi-Turn Dialogue`);
      turns.forEach((t) => {
        lines.push(`### ${t.role === 'user' ? 'You' : `Gemini (${t.modelUsed || 'Gemini 3.6 Flash'})`}`);
        lines.push(t.text);
        lines.push('');
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'reflection').toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="flex flex-col h-full bg-[#fcfaf7] overflow-y-auto">
      {/* Editor Header Toolbar */}
      <div className="border-b border-[#e5e0d3] bg-[#fcfaf7] px-4 sm:px-6 py-4 sticky top-0 z-20 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Title input */}
          <div className="flex-1 min-w-[240px]">
            <input
              id="entry-title-input"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setHasUnsavedChanges(true);
              }}
              placeholder="Give your reflection a title..."
              className="w-full font-serif text-xl sm:text-2xl font-medium text-[#2c2c24] placeholder:text-[#8a8a75] bg-transparent border-0 focus:outline-hidden focus:ring-0 px-0"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Status indicator */}
            <div className="text-xs text-[#8a8a75] mr-2 flex items-center gap-1.5">
              {isSaving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#5a5a40]" />
                  <span>Saving to Firestore...</span>
                </>
              ) : hasUnsavedChanges ? (
                <span className="text-amber-800 font-medium">Unsaved changes</span>
              ) : (
                <span className="text-[#5a5a40] flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  <span>Saved in Vault</span>
                </span>
              )}
            </div>

            <button
              id="save-entry-btn"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-1.5 text-xs font-medium text-[#434338] hover:bg-[#f3efe6] shadow-2xs transition-colors cursor-pointer"
              title="Save to Cloud Firestore"
            >
              <Save className="h-3.5 w-3.5 text-[#5a5a40]" />
              <span className="hidden sm:inline">Save</span>
            </button>

            <button
              id="export-entry-btn"
              onClick={handleExportMarkdown}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-1.5 text-xs font-medium text-[#434338] hover:bg-[#f3efe6] shadow-2xs transition-colors cursor-pointer"
              title="Export reflection as Markdown"
            >
              <Download className="h-3.5 w-3.5 text-[#5a5a40]" />
              <span className="hidden md:inline">Export</span>
            </button>

            {onDelete && (
              <button
                id="delete-entry-btn"
                onClick={() => {
                  if (confirm('Are you sure you want to delete this journal reflection from Firestore?')) {
                    onDelete(entry.id);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/50 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors cursor-pointer"
                title="Delete reflection"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Category, place and sentiment */}
        <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-[#f0ede6] text-xs">
          {/* Category Dropdown */}
          <div className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-[#8a8a75]" />
            <select
              id="category-select"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as CategoryType);
                setHasUnsavedChanges(true);
              }}
              className="rounded-md border border-[#e5e0d3] bg-white px-2 py-1 text-xs font-medium text-[#434338] focus:border-[#5a5a40] focus:outline-hidden"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Location (Amendment D).
              The place name is DERIVED — it came from the Geocoding API, not
              from us — so it renders through UntrustedText like any other
              external-origin string, not as a bare interpolation. */}
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-[#8a8a75]" />
            {location ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e0d3] bg-white px-2 py-1">
                <UntrustedText
                  text={location.placeName}
                  className="text-xs text-[#434338]"
                  placeholder="Unnamed place"
                />
                <button
                  onClick={() => {
                    setLocation(undefined);
                    setHasUnsavedChanges(true);
                  }}
                  title="Remove location"
                  className="cursor-pointer text-[#8a8a75] hover:text-[#2c2c24]"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <button
                id="add-location-btn"
                onClick={() => void attachLocation()}
                disabled={locating}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#e5e0d3] bg-white px-2 py-1 text-xs font-medium text-[#434338] transition-colors hover:bg-[#f3efe6] disabled:opacity-50"
              >
                {locating ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                {locating ? 'Locating…' : 'Add location'}
              </button>
            )}
          </div>

          {locationError && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#8a5a40]">
              {locationError}
              <input
                type="text"
                placeholder="Type a place…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void attachTypedPlace((e.target as HTMLInputElement).value);
                }}
                className="rounded border border-[#e5e0d3] bg-white px-2 py-0.5 text-[11px] text-[#2c2c24] focus:border-[#5a5a40] focus:outline-hidden"
              />
            </span>
          )}

          {sentiment && (
            <span className="ml-auto rounded-full bg-[#f3efe6] border border-[#e5e0d3] px-2.5 py-0.5 text-[11px] font-medium text-[#5a5a40]">
              Sentiment: {sentiment}
            </span>
          )}
        </div>
      </div>

      {/* First-run orientation.
          Two sentences and a dare. It says what the product IS on the screen
          people actually land on, because "Attack it" in the navigation means
          nothing to someone who has never heard of prompt injection. Shown only
          until the first entry is saved — this is onboarding, not chrome. */}
      {isFirstRun && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-[#d8cfae] bg-[#fbf6e6] p-4">
          <p className="font-serif text-base font-semibold text-[#2c2c24]">
            This journal reads pages you point it at — and assumes they're hostile.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[#5a5a40]">
            Text on a web page can carry hidden instructions aimed at the AI, not at you. Here,
            every attempt one makes to hijack this assistant is refused and written to a log you
            can read.
          </p>
          {onOpenRedTeam && (
            <button
              id="first-run-attack-btn"
              onClick={onOpenRedTeam}
              className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 transition-colors hover:bg-rose-100"
            >
              <Swords className="h-4 w-4" />
              Attack it yourself
            </button>
          )}
        </div>
      )}

      {/* Error alert banner */}
      {(errorMsg || saveError) && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <div>
              <p className="font-semibold">Action Alert</p>
              <p>{errorMsg || saveError}</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            className="rounded bg-red-600 px-2.5 py-1 text-white font-medium hover:bg-red-700 cursor-pointer"
          >
            Retry Save
          </button>
        </div>
      )}

      {/* Grounding notice — shown only when connected sources are in play, so
          the user knows external content reached the conversation. */}
      {/*
          The "Grounded in N items" banner is gone. It counted every artifact
          the account had ever ingested, which is not something the user is
          doing right now and not a number they can act on. What matters about
          a turn is whether THIS turn touched external content, and that is on
          the chips and in the taint notice below.
      */}
      {lastTurnTainted && (
        <div className="mx-4 sm:mx-6 mt-4 flex items-center gap-2 rounded-xl border border-[#e5e0d3] bg-[#f3efe6] px-3.5 py-2.5 text-xs text-[#434338]">
          <Github className="h-4 w-4 shrink-0 text-[#5a5a40]" />
          <span className="font-medium text-rose-700">
            Untrusted content was screened before the assistant read it.
          </span>
        </div>
      )}

      {/* What the boundary refused on the last turn. This is the moment the
          product's whole thesis becomes visible, so it renders inline in the
          journal rather than only in the Activity panel. */}
      {lastTurnEvents.filter((e) => e.decision !== 'ALLOW').length > 0 && (
        <div className="mx-4 sm:mx-6 mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs">
          <div className="flex items-center gap-2 font-semibold text-rose-800">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Blocked while answering
          </div>
          <ul className="mt-2 space-y-1.5">
            {lastTurnEvents
              .filter((e) => e.decision !== 'ALLOW')
              .map((e) => (
                <li key={e.callId} className="text-rose-900">
                  <span className="font-mono">{e.tool}</span>
                  {e.decision === 'DENY' ? ' was refused' : ' needs your approval'}
                  {e.reason === 'write_from_tainted_turn' && (
                    <span>
                      {' '}
                      — it was proposed while untrusted content was in context.
                      {e.originSourceIds.length > 0 && (
                        <> Originating source: <strong>{e.originSourceIds.join(', ')}</strong>.</>
                      )}
                    </span>
                  )}
                  {e.decision === 'CONFIRM' && (
                    <span> — open Activity to review the exact arguments.</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 p-4 sm:p-6 max-w-4xl w-full mx-auto space-y-6">
        {/* The conversation IS the journal.
            The mode picker and the separate "write your entry" textarea were
            removed: two input areas on one screen is confusing, and the theme
            is a chat that reads your untrusted world, not a form. Mode still
            exists and defaults to a warm journalling companion; it simply is no
            longer a control the user has to set before typing. */}

        {/* Executive Summary & Insights Card (If generated) */}
        {(summary || (insights && insights.length > 0)) && (
          <div className="rounded-2xl border border-[#e5e0d3] bg-[#f3efe6]/70 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#5a5a40]" />
                <h3 className="font-serif text-base font-semibold text-[#2c2c24]">
                  Executive Synthesis & Key Takeaways
                </h3>
              </div>
              <button
                onClick={handleGenerateSummary}
                disabled={isSummarizing}
                className="text-xs text-[#5a5a40] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${isSummarizing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {summary && (
              <div className="text-sm text-[#434338] leading-relaxed bg-white rounded-xl p-3.5 border border-[#e5e0d3]">
                <p className="font-medium text-xs text-[#2c2c24] mb-1">Core Reflection Summary:</p>
                <p>{summary}</p>
              </div>
            )}

            {insights && insights.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5a5a40]">
                  Actionable Insights & Reframing
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {insights.map((insight, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 bg-white rounded-xl p-3 border border-[#e5e0d3] text-xs text-[#434338] leading-relaxed shadow-2xs"
                    >
                      <Check className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((t, idx) => (
                  <span
                    key={idx}
                    className="rounded-md bg-[#e5e0d3] px-2 py-0.5 text-[11px] font-medium text-[#434338]"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Conversation.
            Rendered ALWAYS, not only once turns exist. Gating this on
            turns.length > 0 meant a new entry had no composer at all — and
            therefore no + button, so the one thing this product is for
            (bringing outside content in) was unreachable until the user had
            already written something and pressed Reflect. */}
        {(
          <div className="rounded-2xl border border-[#e5e0d3] bg-white p-5 shadow-2xs space-y-5">
            {turns.length > 0 && (
              <div className="flex items-center justify-between border-b border-[#f0ede6] pb-3">
                <h3 className="font-serif text-base font-semibold text-[#2c2c24] flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#5a5a40]" />
                  <span>Conversation</span>
                </h3>
                <span className="text-xs text-[#8a8a75]">
                  {turns.length} exchange{turns.length === 1 ? '' : 's'}
                </span>
              </div>
            )}

            <div className="space-y-4">
              {turns.map((turn, index) => {
                const isUser = turn.role === 'user';
                return (
                  <div
                    key={turn.id || index}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-[#8a8a75]">
                      <span className="font-medium">
                        {isUser ? 'You' : `Gemini (${turn.modelUsed || 'gemini-3.6-flash'})`}
                      </span>
                      <span>&bull;</span>
                      <span>
                        {turn.timestamp
                          ? new Date(turn.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>

                    <div
                      className={`relative group max-w-[90%] sm:max-w-[82%] rounded-2xl p-4 text-sm leading-relaxed ${
                        isUser
                          ? 'bg-[#5a5a40] text-white rounded-br-xs shadow-xs'
                          : 'bg-[#f8f6f0] text-[#2c2c24] rounded-bl-xs border border-[#e5e0d3]'
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap font-sans">{turn.text}</p>
                      ) : (
                        // INV-9: assistant output is DERIVED from untrusted content.
                        // Rendered escaped, never as markdown - a markdown image
                        // tag would exfiltrate on paint, with no tool call needed.
                        <UntrustedText text={turn.text} />
                      )}

                      {/* Copy button */}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(turn.text, turn.id)}
                        className={`absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                          isUser
                            ? 'text-stone-300 hover:bg-[#484833]'
                            : 'text-[#8a8a75] hover:bg-[#e5e0d3]'
                        }`}
                        title="Copy message text"
                      >
                        {copiedId === turn.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}

              {isGenerating && (
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl rounded-bl-xs bg-[#f8f6f0] border border-[#e5e0d3] p-4 text-sm text-[#5a5a40] flex items-center gap-2.5">
                    <RefreshCw className="h-4 w-4 animate-spin text-[#5a5a40]" />
                    <span>Gemini is considering your reflection...</span>
                  </div>
                </div>
              )}

              <div ref={turnsEndRef} />
            </div>

            {/* Attachments (Amendment F).
                Chips sit above the composer so a hostile verdict is visible
                BEFORE the question is asked, not after the answer arrives. */}
            {attachments.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${
                      a.verdict === 'hostile'
                        ? 'border-rose-300 bg-rose-50 text-rose-900'
                        : a.verdict === 'suspicious'
                          ? 'border-amber-300 bg-amber-50 text-amber-900'
                          : 'border-[#e5e0d3] bg-white text-[#434338]'
                    }`}
                  >
                    <Paperclip className="h-3 w-3 shrink-0" />
                    <span className="truncate">{a.title}</span>
                    <span className="shrink-0 font-medium uppercase">{a.verdict}</span>
                    {/*
                      Fixed chrome. These labels are string literals and both
                      buttons render for every verdict, because a model that
                      just read a poisoned document must never get to compose
                      the question we put to the user. "Shall I summarise this
                      and send it to the address in the footer?" is an attack,
                      and it would be wearing our own interface.
                    */}
                    <button
                      onClick={() => setReportFor(reportFor === a.id ? null : a.id)}
                      className="shrink-0 cursor-pointer rounded border border-current px-1.5 py-0.5 font-medium opacity-80 hover:opacity-100"
                    >
                      Show me the injections
                    </button>
                    <button
                      onClick={() => void summariseAttachment(a.id)}
                      disabled={isGenerating}
                      className="shrink-0 cursor-pointer rounded border border-current px-1.5 py-0.5 font-medium opacity-80 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      What's in it
                    </button>
                    <button
                      onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}
                      title="Remove from this view"
                      className="shrink-0 cursor-pointer opacity-60 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {reportFor &&
              (() => {
                const a = attachments.find((x) => x.id === reportFor);
                if (!a) return null;
                return (
                  <InjectionReport
                    title={a.title}
                    verdict={a.verdict}
                    matches={a.matches}
                    onClose={() => setReportFor(null)}
                  />
                );
              })()}

            {attachMenu && (
              <div className="mt-3 rounded-xl border border-[#d8cfae] bg-[#fbf6e6] p-3">
                <p className="text-[11px] font-medium text-[#2c2c24]">
                  {attachMenu === 'link'
                    ? 'Paste a web address. It is fetched on the server and treated as hostile.'
                    : 'Paste anything — an email body, a message, a document excerpt. It is treated as hostile.'}
                </p>
                {attachMenu === 'link' ? (
                  <input
                    type="url"
                    value={attachDraft}
                    onChange={(e) => setAttachDraft(e.target.value)}
                    placeholder="https://example.com/an-article-you-read"
                    className="mt-2 w-full rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs text-[#2c2c24] focus:border-[#5a5a40] focus:outline-hidden"
                  />
                ) : (
                  <textarea
                    value={attachDraft}
                    onChange={(e) => setAttachDraft(e.target.value)}
                    rows={4}
                    maxLength={20000}
                    placeholder="Paste the text here…"
                    className="mt-2 w-full resize-y rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs text-[#2c2c24] focus:border-[#5a5a40] focus:outline-hidden"
                  />
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => void submitAttachment()}
                    disabled={attaching || !attachDraft.trim()}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#5a5a40] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#484833] disabled:opacity-50"
                  >
                    {attaching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                    {attaching ? 'Reading…' : 'Attach'}
                  </button>
                  <button
                    onClick={() => {
                      setAttachMenu(null);
                      setAttachDraft('');
                      setAttachError(null);
                    }}
                    className="cursor-pointer text-xs text-[#8a8a75] hover:text-[#2c2c24]"
                  >
                    Cancel
                  </button>
                  {attachError && <span className="text-[11px] text-rose-700">{attachError}</span>}
                </div>
              </div>
            )}

            {/* Follow-up input box */}
            {pasteOffer && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#d8cfae] bg-[#fbf6e6] px-3 py-2 text-[11px] text-[#5a5a40]">
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {pasteOffer.kind === 'link'
                    ? 'You pasted a link. Did someone send it to you?'
                    : 'You pasted a lot of text. Did it come from somewhere else?'}
                </span>
                <button
                  type="button"
                  onClick={() => void acceptPasteOffer()}
                  disabled={attaching}
                  className="cursor-pointer rounded border border-rose-300 bg-rose-50 px-2 py-0.5 font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                >
                  Check it as hostile
                </button>
                <button
                  type="button"
                  onClick={() => setPasteOffer(null)}
                  className="cursor-pointer text-[#8a8a75] underline"
                >
                  No, it&rsquo;s mine
                </button>
              </div>
            )}

            {repoPrompt && (
              <div className="mt-3 rounded-xl border border-[#d8cfae] bg-[#fbf6e6] p-3">
                <p className="text-[11px] font-medium text-[#2c2c24]">
                  Scan a public repository for prompt injections
                </p>
                <p className="mt-0.5 text-[10px] text-[#5a5a40]">
                  Files are read on the server, matched against fixed patterns, and discarded.
                  Nothing is stored and no model sees them &mdash; so this reports where the
                  injections are, and cannot tell you what the code does.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={repoRef}
                    onChange={(e) => setRepoRef(e.target.value)}
                    placeholder="owner/name"
                    className="flex-1 rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs text-[#2c2c24] placeholder:text-[#b5b0a0] focus:border-[#5a5a40] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void runRepoScan()}
                    disabled={repoScanning || !repoRef.trim()}
                    className="cursor-pointer rounded-lg bg-[#5a5a40] px-3 py-2 text-xs font-medium text-white hover:bg-[#484833] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {repoScanning ? 'Scanning…' : 'Scan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRepoPrompt(false)}
                    className="cursor-pointer text-[11px] text-[#8a8a75] underline"
                  >
                    Cancel
                  </button>
                </div>

                {repoProgress && (
                  <div className="mt-2.5">
                    <div className="flex items-baseline justify-between gap-2 text-[10px] text-[#5a5a40]">
                      <span className="truncate font-mono">{repoProgress.path || 'reading…'}</span>
                      <span className="shrink-0 tabular-nums">
                        {repoProgress.scanned} / {repoProgress.total}
                        {repoProgress.live > 0 ? (
                          <span className="ml-1.5 font-medium text-rose-700">
                            {repoProgress.live} live
                          </span>
                        ) : (
                          repoProgress.findings > 0 && (
                            <span className="ml-1.5 text-[#8a8a75]">
                              {repoProgress.findings} to triage
                            </span>
                          )
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#e5e0d3]">
                      <div
                        className="h-full rounded-full bg-[#5a5a40] transition-[width] duration-200"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (repoProgress.scanned / Math.max(1, repoProgress.total)) * 100,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {repoResult && (
              <RepoScanReport result={repoResult} onClose={() => setRepoResult(null)} />
            )}

            {webSearch && mentionsUrl(followUpInput) && (
              <button
                type="button"
                onClick={() => void screenPastedLinks()}
                disabled={isGenerating}
                className="mt-2 cursor-pointer rounded-lg border border-[#d8cfae] bg-[#fbf6e6] px-3 py-1.5 text-[11px] font-medium text-[#2c2c24] hover:bg-[#f5eeda] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Fetch and screen this link
              </button>
            )}

            {!webSearch && mentionsUrl(followUpInput) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#d8cfae] bg-[#fbf6e6] px-3 py-2 text-[11px] text-[#5a5a40]">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span>That link will be ignored. Turn on Web to fetch and read it.</span>
                <button
                  type="button"
                  onClick={() => setWebSearch(true)}
                  className="cursor-pointer font-medium underline"
                >
                  Enable web search
                </button>
              </div>
            )}

            <form
              onSubmit={handleSendFollowUp}
              className="mt-4 pt-3 border-t border-[#f0ede6] flex items-center gap-2"
            >
              {/* One entry point instead of four.
                  Four bare icons beside the composer read as a toolbar and
                  make the user decode each one before typing. A single + that
                  opens a labelled menu is the pattern people already know from
                  every other assistant, and it leaves room to add sources
                  without the row growing again. */}
              <div className="relative shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void submitFile(f);
                  }}
                />
                <button
                  type="button"
                  id="attach-menu-btn"
                  onClick={() => setPlusOpen((v) => !v)}
                  disabled={attaching}
                  title="Add something for it to read"
                  aria-haspopup="menu"
                  aria-expanded={plusOpen}
                  className="inline-flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-xl border border-[#e5e0d3] bg-white text-[#5a5a40] transition-colors hover:bg-[#f3efe6] disabled:opacity-50"
                >
                  {attaching ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>

                {plusOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPlusOpen(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-xl border border-[#e5e0d3] bg-white py-1 shadow-lg">
                      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a8a75]">
                        From outside &mdash; treated as hostile
                      </p>
                      {[
                        {
                          id: 'menu-file',
                          Icon: FileUp,
                          label: 'Upload a PDF or image',
                          hint: 'Text is read, the file is discarded',
                          run: () => fileInputRef.current?.click(),
                        },
                        {
                          id: 'menu-mail',
                          Icon: Mail,
                          label: 'Connect a mailbox',
                          hint: 'Read-only, recent messages',
                          run: () => void handleMail(),
                        },
                        {
                          id: 'menu-repo',
                          Icon: Github,
                          label: githubConnected ? 'GitHub connected' : 'Connect GitHub',
                          hint: githubConnected
                            ? 'Paste a repository URL to scan it'
                            : 'Read your repositories, including private ones',
                          run: () =>
                            githubConnected ? setRepoPrompt(true) : void connectGithub(),
                        },
                      ].map(({ id, Icon, label, hint, run }) => (
                        <button
                          key={id}
                          id={id}
                          type="button"
                          onClick={() => {
                            setPlusOpen(false);
                            run();
                          }}
                          className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left hover:bg-[#f3efe6]"
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#5a5a40]" />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-[#2c2c24]">{label}</span>
                            <span className="block text-[10px] text-[#8a8a75]">{hint}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                id="web-search-toggle"
                onClick={() => setWebSearch((v) => !v)}
                title={
                  webSearch
                    ? 'Web search on — links you type are fetched and read'
                    : 'Web search off — links you type are ignored'
                }
                aria-pressed={webSearch}
                className={`inline-flex h-[42px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors ${
                  webSearch
                    ? 'border-[#5a5a40] bg-[#5a5a40] text-white'
                    : 'border-[#e5e0d3] bg-white text-[#8a8a75] hover:bg-[#f3efe6]'
                }`}
              >
                <Globe className="h-4 w-4" />
                <span className="hidden sm:inline">Web</span>
              </button>

              <input
                id="followup-input"
                type="text"
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onPaste={(e) => onComposerPaste(e.clipboardData.getData('text'))}
                placeholder={turns.length === 0 ? "What is on your mind? Or add something with + and ask about it…" : "Ask a follow-up, or add another angle…"}
                disabled={isGenerating}
                className="flex-1 rounded-xl border border-[#e5e0d3] bg-[#f8f6f0] px-4 py-2.5 text-xs sm:text-sm text-[#2c2c24] placeholder:text-[#8a8a75] focus:bg-white focus:border-[#5a5a40] focus:outline-hidden transition-colors"
              />
              <button
                id="send-followup-btn"
                type="submit"
                disabled={isGenerating || !followUpInput.trim()}
                className="inline-flex items-center justify-center rounded-xl bg-[#5a5a40] p-2.5 text-white hover:bg-[#484833] disabled:opacity-40 transition-colors cursor-pointer"
                title="Send follow-up"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
