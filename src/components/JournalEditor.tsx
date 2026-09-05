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
  Square,
} from 'lucide-react';
import {
  JournalEntry,
  TurnMessage,
  CategoryType,
  ReflectionMode,
  Match,
} from '../types';
import { requestSummary } from '../lib/geminiApi';
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
  githubDisconnect,
  resolveRepoName,
  type ScanProgress,
} from '../lib/perimeterApi';
import { extractUrls, mentionsUrl } from '../lib/urls';
import { ThreatEvent } from '../lib/agentApi';
import { UntrustedText } from './UntrustedText';
import { ChatTranscript } from './ChatTranscript';
import { runChatTurn, type TurnStage } from '../lib/chatTurn';
import { findRepoReference } from '../lib/repoRef';
import {
  repoSummaryText,
  repoAmbiguousText,
  repoNoIntentText,
} from '../lib/findingMessage';
import { isSilentFinding } from '../lib/findingMessage';
import { reflectGroundedStream } from '../lib/reflect';
import { ChatAborted } from '../lib/chatStream';

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
      kind: 'file' | 'link' | 'note' | 'repo';
      verdict: 'clean' | 'suspicious' | 'hostile';
      /** Where each signal fired. Empty is a real answer: nothing matched. */
      matches: Match[];
    }[]
  >([]);
  /** A repository scan in flight, and its result. Never persisted (INV-18). */
  const [repoPrompt, setRepoPrompt] = useState(false);
  const [repoScanning, setRepoScanning] = useState(false);
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
  // Which half failed. A save failure means the reply on screen is not
  // persisted, and the banner has to say so rather than offering a retry
  // that would re-ask the model.
  const [failureStage, setFailureStage] = useState<TurnStage | null>(null);
  // Amendment L. The reply as it arrives. Provisional: not persisted, and
  // rendered as unfinished until the stream completes.
  const [streamingText, setStreamingText] = useState('');
  // Set from the stream's first record, BEFORE any text is painted (INV-20).
  const [streamingTaint, setStreamingTaint] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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
        { id: r.artifactId, title: r.title, kind: 'file' as const, verdict: r.verdict, matches: r.matches ?? [] },
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
          kind: 'note' as const,
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
          kind: offer.kind === 'link' ? ('link' as const) : ('note' as const),
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
          kind: attachMenu === 'link' ? ('link' as const) : ('note' as const),
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

      // Amendment L. One controller per turn, held so the stop button can
      // abort this stream and only this one.
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamingText('');
      setStreamingTaint(false);


      // Same orchestration as a follow-up, and for the same reason: this
      // handler carried the identical pair of defects — colliding Date.now()
      // ids, and one try/catch over both the model call and the write, so a
      // failed save reported "Gemini reflection request failed" when Gemini
      // had in fact replied.
      const outcome = await runChatTurn(
        userPrompt || 'Please reflect on my journal context.',
        turns,
        {
          send: (nextTurns, onDelta) =>
            reflectGroundedStream(
              {
                content: userPrompt,
                mode,
                category,
                turns: nextTurns,
                groundingArtifactIds,
              },
              {
                onMeta: (m) => setStreamingTaint(m.turnTaint),
                onDelta,
                signal: controller.signal,
              },
            ),
          save: async (nextTurns) => {
            const updated = { ...getCurrentEntryObject(), turns: nextTurns };
            await onSave(updated);
            // Name and synthesise the entry from the exchange, once. Inside
            // save so it cannot run for an exchange that was never persisted.
            void autoTitle(updated);
          },
          onTurns: (nextTurns) => {
            setTurns(nextTurns);
            setHasUnsavedChanges(true);
          },
          clearInput: () => setHasUnsavedChanges(false),
          onStreamingText: setStreamingText,
          isAbort: (err) => err instanceof ChatAborted,
        },
      );

      if (outcome.reply) {
        setLastTurnEvents(outcome.reply.threatEvents);
        setLastTurnTainted(outcome.reply.turnTaint);
      }
      if (outcome.failure) {
        setErrorMsg(outcome.failure.message);
        setFailureStage(outcome.failure.stage);
      } else {
        setFailureStage(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gemini reflection request failed.');
      setFailureStage('send');
    } finally {
      abortRef.current = null;
      setStreamingText('');
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
   * Disconnects it. Revokes at GitHub, not merely locally — a classic OAuth
   * App token does not expire, so deleting our copy while the grant is still
   * live would leave the user believing they had disconnected.
   */
  const disconnectGithub = async () => {
    setAttachError(null);
    try {
      await githubDisconnect();
      setGithubConnected(false);
    } catch (err: any) {
      setAttachError(err?.message ?? 'Could not disconnect GitHub.');
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
          { id: r.artifactId, title: r.url ?? url, kind: 'link' as const, verdict: r.verdict, matches: r.matches ?? [] },
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


  // Handle Follow-up in Multi-Turn dialogue
  /**
   * @param override Supplied by the "What's in it" button: a fixed question and
   * one artifact to ground it on. It exists so that button reuses this exact
   * path — the same Reader, the same broker, the same log — rather than a
   * second route to the Planner that could drift out of step with this one.
   */
  /**
   * Appends a message Perimeter wrote. Deterministic prose, never model output.
   */
  const sayPerimeter = (text: string) => {
    setTurns((prev) => {
      const next = [
        ...prev,
        {
          id: `msg-perimeter-${crypto.randomUUID?.() ?? Date.now()}`,
          role: 'perimeter' as const,
          text,
          timestamp: new Date().toISOString(),
        },
      ];
      void onSave({ ...getCurrentEntryObject(), turns: next }).catch(() => undefined);
      return next;
    });
  };

  /**
   * A repository named in the USER's message — never in a turn, an artifact or
   * a scan result. The rule extractUrls follows, for the same reason: a
   * repository name inside untrusted content is an attacker choosing what our
   * server fetches.
   *
   * Returns true when it handled the message, so the model is not also asked.
   */
  const handleRepoMention = async (text: string): Promise<boolean> => {
    const found = findRepoReference(text);
    if (!found) return false;

    let ref: string | null = null;

    if (found.kind === 'explicit') {
      ref = found.ref;
    } else {
      // A bare name is a candidate, not an answer.
      try {
        const r = await resolveRepoName(found.name);
        if (r.kind === 'one') ref = r.ref;
        else {
          sayPerimeter(repoAmbiguousText(found.name, r.kind === 'many' ? r.candidates : []));
          return true;
        }
      } catch {
        sayPerimeter(repoAmbiguousText(found.name, []));
        return true;
      }
    }

    // We know WHICH repository. Whether the user wants it scanned is a
    // separate question, and guessing is how a tool does something nobody
    // asked for.
    if (!/(scan|inject|injection|injections|check|audit|security)/i.test(text)) {
      sayPerimeter(repoNoIntentText(ref));
      return true;
    }

    setRepoScanning(true);
    setRepoProgress(null);
    try {
      const result = await scanRepository(ref, setRepoProgress);
      sayPerimeter(
        repoSummaryText({
          repo: result.repo,
          defaultBranch: result.defaultBranch,
          coverage: result.coverage,
          headline: result.headline,
          findings: result.findings.map((f) => ({ path: f.path, tier: f.tier, role: f.role })),
          warnings: result.warnings,
        }),
      );
    } catch (err: any) {
      sayPerimeter(
        `I could not scan **${ref}**. ${err?.message ?? 'The repository could not be read.'}`,
      );
    } finally {
      setRepoScanning(false);
      setRepoProgress(null);
    }
    return true;
  };

  const handleSendFollowUp = async (
    e?: React.FormEvent,
    override?: { text: string; grounding: string[] },
  ) => {
    if (e) e.preventDefault();
    const followUpText = override?.text ?? followUpInput.trim();
    if (!followUpText || isGenerating) return;

    setErrorMsg(null);

    // A repository named in the message is handled here and the model is not
    // asked. The scan runs no model by construction (INV-18), so routing it
    // through the Planner would add nothing but latency and a chance for a
    // poisoned file to influence how its own scan is described.
    if (!override) {
      const userTurn = {
        id: `msg-user-${crypto.randomUUID?.() ?? Date.now()}`,
        role: 'user' as const,
        text: followUpText,
        timestamp: new Date().toISOString(),
      };
      const probe = findRepoReference(followUpText);
      if (probe) {
        setFollowUpInput('');
        setTurns((prev) => [...prev, userTurn]);
        setIsGenerating(true);
        try {
          if (await handleRepoMention(followUpText)) return;
        } finally {
          setIsGenerating(false);
        }
      }
    }

    setIsGenerating(true);

    try {
      // Amendment L. One controller per turn, held so the stop button can
      // abort this stream and only this one.
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamingText('');
      setStreamingTaint(false);

      // Web search — links in YOUR message only.
      //
      // extractUrls is deliberately never applied to a turn, an artifact or an
      // attachment. A link inside untrusted content is an attacker choosing
      // what our server requests, and following one would hand them a fetch
      // primitive aimed wherever they like.
      const extraGrounding = webSearch ? await fetchAndScreenUrls(followUpText) : [];

      // Orchestrated in src/lib/chatTurn.ts, where the ordering is tested.
      // Two data-loss defects lived here when this was inline: the composer
      // was cleared before the request, and one try/catch covered both the
      // model call and the write, so a failed save was reported as a failed
      // send. Both were breaches of Directive 6.
      const outcome = await runChatTurn(followUpText, turns, {
        send: (nextTurns, onDelta) =>
          reflectGroundedStream(
            {
              content: content.trim(),
              mode,
              category,
              turns: nextTurns,
              // Newly fetched ids are merged here rather than waiting for the
              // parent to refresh: the prop would still be stale on this turn.
              groundingArtifactIds: [
                ...groundingArtifactIds,
                ...extraGrounding,
                ...(override?.grounding ?? []),
              ],
            },
            {
              // INV-20: this fires before the first delta, always.
              onMeta: (m) => setStreamingTaint(m.turnTaint),
              onDelta,
              signal: controller.signal,
            },
          ),
        save: async (nextTurns) => {
          await onSave({ ...getCurrentEntryObject(), turns: nextTurns });
        },
        onTurns: (nextTurns) => {
          setTurns(nextTurns);
          setHasUnsavedChanges(true);
        },
        // An override's text came from a fixed button, not the composer, so
        // there is nothing of the user's to clear.
        clearInput: () => {
          if (!override) setFollowUpInput('');
          setHasUnsavedChanges(false);
        },
        onStreamingText: setStreamingText,
        isAbort: (err) => err instanceof ChatAborted,
      },
      {
        // What the user attached rides in THEIR message, and what the scan
        // found becomes a Perimeter message right after it — both only once
        // they have actually asked something.
        attachments: attachments.map((a) => ({
          id: a.id,
          title: a.title,
          kind: a.kind,
        })),
        findings: attachments
          .map((a) => ({
            title: a.title,
            verdict: a.verdict,
            matches: (a.matches ?? []).map((m) => ({
              signal: m.signal,
              line: m.line,
              excerpt: m.excerpt,
              hidden: m.hidden,
            })),
          }))
          .filter((f) => !isSilentFinding(f)),
      });

      // Consumed by this turn. They live in the transcript now.
      if (!outcome.failure) setAttachments([]);

      if (outcome.reply) {
        setLastTurnEvents(outcome.reply.threatEvents);
        setLastTurnTainted(outcome.reply.turnTaint);
      }
      if (outcome.failure) {
        setErrorMsg(outcome.failure.message);
        setFailureStage(outcome.failure.stage);
      } else {
        setFailureStage(null);
      }
    } catch (err: any) {
      // Only reachable from fetchAndScreenUrls; runChatTurn does not throw.
      setErrorMsg(err?.message || 'Could not prepare that message.');
      setFailureStage('send');
    } finally {
      abortRef.current = null;
      setStreamingText('');
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

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="flex flex-col h-full bg-[#ffffff] overflow-y-auto">
      {/* Editor Header Toolbar */}
      <div className="border-b border-[#e5e5e5] bg-[#ffffff] px-4 sm:px-6 py-4 sticky top-0 z-20 shadow-2xs">
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
              className="w-full font-serif text-xl sm:text-2xl font-medium text-[#1a1a1a] placeholder:text-[#6b6b6b] bg-transparent border-0 focus:outline-hidden focus:ring-0 px-0"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Status indicator */}
            <div className="text-xs text-[#6b6b6b] mr-2 flex items-center gap-1.5">
              {isSaving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#1a1a1a]" />
                  <span>Saving to Firestore...</span>
                </>
              ) : hasUnsavedChanges ? (
                <span className="text-amber-800 font-medium">Unsaved changes</span>
              ) : (
                <span className="text-[#1a1a1a] flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  <span>Saved in Vault</span>
                </span>
              )}
            </div>

            <button
              id="save-entry-btn"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#3f3f3f] hover:bg-[#f7f7f8] shadow-2xs transition-colors cursor-pointer"
              title="Save to Cloud Firestore"
            >
              <Save className="h-3.5 w-3.5 text-[#1a1a1a]" />
              <span className="hidden sm:inline">Save</span>
            </button>

            <button
              id="export-entry-btn"
              onClick={handleExportMarkdown}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#3f3f3f] hover:bg-[#f7f7f8] shadow-2xs transition-colors cursor-pointer"
              title="Export reflection as Markdown"
            >
              <Download className="h-3.5 w-3.5 text-[#1a1a1a]" />
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
        <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-[#f0f0f0] text-xs">
          {/* Category Dropdown */}
          <div className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-[#6b6b6b]" />
            <select
              id="category-select"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as CategoryType);
                setHasUnsavedChanges(true);
              }}
              className="rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-medium text-[#3f3f3f] focus:border-[#1a1a1a] focus:outline-hidden"
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
            <MapPin className="h-3.5 w-3.5 text-[#6b6b6b]" />
            {location ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] bg-white px-2 py-1">
                <UntrustedText
                  text={location.placeName}
                  className="text-xs text-[#3f3f3f]"
                  placeholder="Unnamed place"
                />
                <button
                  onClick={() => {
                    setLocation(undefined);
                    setHasUnsavedChanges(true);
                  }}
                  title="Remove location"
                  className="cursor-pointer text-[#6b6b6b] hover:text-[#1a1a1a]"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <button
                id="add-location-btn"
                onClick={() => void attachLocation()}
                disabled={locating}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-medium text-[#3f3f3f] transition-colors hover:bg-[#f7f7f8] disabled:opacity-50"
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
                className="rounded border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-hidden"
              />
            </span>
          )}

          {sentiment && (
            <span className="ml-auto rounded-full bg-[#f7f7f8] border border-[#e5e5e5] px-2.5 py-0.5 text-[11px] font-medium text-[#1a1a1a]">
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
          <p className="font-serif text-base font-semibold text-[#1a1a1a]">
            This journal reads pages you point it at — and assumes they're hostile.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[#1a1a1a]">
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

      {/* Error alert banner.
          The heading and the action both follow the stage that failed. This
          block previously showed "Action Alert" and a "Retry Save" button for
          every failure, including one where nothing had been sent — the same
          defect as the message it accompanied: advice that does not match the
          cause. Retrying a save that never happened does nothing. */}
      {(errorMsg || saveError) && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <div>
              <p className="font-semibold">
                {failureStage === 'send'
                  ? 'Message not sent'
                  : failureStage === 'save'
                    ? 'Reply not saved'
                    : 'Action Alert'}
              </p>
              <p>{errorMsg || saveError}</p>
              {failureStage === 'send' && (
                <p className="mt-1 text-red-600/80">
                  Your message is still in the box below. Press send to try again.
                </p>
              )}
            </div>
          </div>
          {failureStage !== 'send' && (
            <button
              onClick={handleSave}
              className="shrink-0 rounded bg-red-600 px-2.5 py-1 text-white font-medium hover:bg-red-700 cursor-pointer"
            >
              Retry Save
            </button>
          )}
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
        <div className="mx-4 sm:mx-6 mt-4 flex items-center gap-2 rounded-xl border border-[#e5e5e5] bg-[#f7f7f8] px-3.5 py-2.5 text-xs text-[#3f3f3f]">
          <Github className="h-4 w-4 shrink-0 text-[#1a1a1a]" />
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
      <div className="flex flex-1 flex-col p-4 sm:p-6 max-w-4xl w-full mx-auto space-y-6">
        {/* The conversation IS the journal.
            The mode picker and the separate "write your entry" textarea were
            removed: two input areas on one screen is confusing, and the theme
            is a chat that reads your untrusted world, not a form. Mode still
            exists and defaults to a warm journalling companion; it simply is no
            longer a control the user has to set before typing. */}

        {/* Executive Summary & Insights Card (If generated) */}
        {(summary || (insights && insights.length > 0)) && (
          <div className="rounded-2xl border border-[#e5e5e5] bg-[#f7f7f8]/70 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#1a1a1a]" />
                <h3 className="font-serif text-base font-semibold text-[#1a1a1a]">
                  Executive Synthesis & Key Takeaways
                </h3>
              </div>
              <button
                onClick={handleGenerateSummary}
                disabled={isSummarizing}
                className="text-xs text-[#1a1a1a] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${isSummarizing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {summary && (
              <div className="text-sm text-[#3f3f3f] leading-relaxed bg-white rounded-xl p-3.5 border border-[#e5e5e5]">
                <p className="font-medium text-xs text-[#1a1a1a] mb-1">Core Reflection Summary:</p>
                <p>{summary}</p>
              </div>
            )}

            {insights && insights.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#1a1a1a]">
                  Actionable Insights & Reframing
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {insights.map((insight, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 bg-white rounded-xl p-3 border border-[#e5e5e5] text-xs text-[#3f3f3f] leading-relaxed shadow-2xs"
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
                    className="rounded-md bg-[#e5e5e5] px-2 py-0.5 text-[11px] font-medium text-[#3f3f3f]"
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
          <div className="flex flex-1 flex-col rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-5">
            {turns.length > 0 && (
              <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
                <h3 className="font-serif text-base font-semibold text-[#1a1a1a] flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#1a1a1a]" />
                  <span>Conversation</span>
                </h3>
                <span className="text-xs text-[#6b6b6b]">
                  {turns.length} exchange{turns.length === 1 ? '' : 's'}
                </span>
              </div>
            )}

            {/* Grows to fill the card, so the composer sits at the BOTTOM of
                the panel rather than floating under an empty conversation. A
                new chat opened with the input at the top of the screen, which
                is the one place a chat input never is. */}
            <div className="flex flex-1 flex-col justify-end space-y-4">
              <ChatTranscript turns={turns} />

              {/* The provisional turn — Amendment L, INV-20.
                  The taint verdict is set from the stream's FIRST record, so
                  when this paints with a warning the warning is already
                  correct: no attacker-influenceable character has been shown
                  before it. The dashed border and the "not saved yet" line
                  say plainly that this is unfinished and unpersisted. */}
              {isGenerating && (
                <div className="flex items-start gap-3">
                  <div
                    className={`min-w-0 max-w-full rounded-2xl rounded-bl-xs border border-dashed p-4 text-sm ${
                      streamingTaint
                        ? 'border-amber-400 bg-amber-50/60'
                        : 'border-[#d8d2c4] bg-[#fafafa]'
                    }`}
                  >
                    {streamingTaint && (
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-800">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                        External content is in this turn. Anything below may reflect it.
                      </p>
                    )}

                    {streamingText ? (
                      <UntrustedText text={streamingText} />
                    ) : (
                      <span className="flex items-center gap-2.5 text-[#1a1a1a]">
                        <RefreshCw className="h-4 w-4 animate-spin text-[#1a1a1a]" />
                        Thinking...
                      </span>
                    )}

                    <div className="mt-2.5 flex items-center gap-3 border-t border-[#e5e5e5] pt-2">
                      <span className="text-[10px] text-[#6b6b6b]">
                        {streamingText ? 'Still writing - not saved yet' : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => abortRef.current?.abort()}
                        className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[#d8d2c4] px-2 py-0.5 text-[10px] text-[#1a1a1a] hover:bg-[#efeade]"
                      >
                        <Square className="h-2.5 w-2.5 fill-current" />
                        Stop
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div ref={turnsEndRef} />
            </div>

            {/* Attachments, waiting for a prompt — Amendment F.
                No verdict and no action buttons. Both used to appear the
                instant a file finished uploading, which meant the application
                announced a conclusion and offered two questions before the
                user had asked anything at all. The screening still happens on
                upload; what it found is reported in the CONVERSATION, once the
                user sends something, as a message we author from the
                deterministic scan. */}
            {attachments.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-[11px] text-[#3f3f3f]"
                  >
                    <Paperclip className="h-3 w-3 shrink-0" />
                    <span className="truncate">{a.title}</span>
                    <button
                      onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}
                      title="Remove"
                      className="shrink-0 cursor-pointer opacity-60 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {attachMenu && (
              <div className="mt-3 rounded-xl border border-[#d8cfae] bg-[#fbf6e6] p-3">
                <p className="text-[11px] font-medium text-[#1a1a1a]">
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
                    className="mt-2 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-hidden"
                  />
                ) : (
                  <textarea
                    value={attachDraft}
                    onChange={(e) => setAttachDraft(e.target.value)}
                    rows={4}
                    maxLength={20000}
                    placeholder="Paste the text here…"
                    className="mt-2 w-full resize-y rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-hidden"
                  />
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => void submitAttachment()}
                    disabled={attaching || !attachDraft.trim()}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#000000] disabled:opacity-50"
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
                    className="cursor-pointer text-xs text-[#6b6b6b] hover:text-[#1a1a1a]"
                  >
                    Cancel
                  </button>
                  {attachError && <span className="text-[11px] text-rose-700">{attachError}</span>}
                </div>
              </div>
            )}

            {/* Follow-up input box */}
            {pasteOffer && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#d8cfae] bg-[#fbf6e6] px-3 py-2 text-[11px] text-[#1a1a1a]">
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
                  className="cursor-pointer text-[#6b6b6b] underline"
                >
                  No, it&rsquo;s mine
                </button>
              </div>
            )}

            {webSearch && mentionsUrl(followUpInput) && (
              <button
                type="button"
                onClick={() => void screenPastedLinks()}
                disabled={isGenerating}
                className="mt-2 cursor-pointer rounded-lg border border-[#d8cfae] bg-[#fbf6e6] px-3 py-1.5 text-[11px] font-medium text-[#1a1a1a] hover:bg-[#f5eeda] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Fetch and screen this link
              </button>
            )}

            {!webSearch && mentionsUrl(followUpInput) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#d8cfae] bg-[#fbf6e6] px-3 py-2 text-[11px] text-[#1a1a1a]">
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

            {/* The composer, as one field.
                The + button, the Web toggle, the textarea and the send button
                were four separate bordered controls sitting in a row, which
                read as a toolbar rather than as somewhere to type. They are
                now one bordered surface that takes the focus ring as a whole,
                the way a chat input does. */}
            <form
              onSubmit={handleSendFollowUp}
              className="mt-4 flex items-center gap-2 rounded-2xl border border-[#e5e5e5] bg-white p-2 transition-shadow focus-within:border-[#1a1a1a] focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.14)]"
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
                  className="inline-flex h-[38px] w-[38px] cursor-pointer items-center justify-center rounded-xl text-[#1a1a1a] transition-colors hover:bg-[#f7f7f8] disabled:opacity-50"
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
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-xl border border-[#e5e5e5] bg-white py-1 shadow-lg">
                      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b6b6b]">
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
                          // A connector, not an action. It says which state it
                          // is in and the click changes that state — connect
                          // when disconnected, disconnect when connected.
                          // Scanning is not a menu item any more: a repository
                          // is named in the message, like everything else.
                          label: githubConnected ? 'GitHub' : 'Connect GitHub',
                          hint: githubConnected
                            ? 'Connected. Name a repository in your message.'
                            : 'Read your repositories, including private ones',
                          connector: true,
                          on: githubConnected,
                          run: () =>
                            githubConnected ? void disconnectGithub() : void connectGithub(),
                        },
                      ].map(({ id, Icon, label, hint, run, connector, on }: any) => (
                        <button
                          key={id}
                          id={id}
                          type="button"
                          onClick={() => {
                            setPlusOpen(false);
                            run();
                          }}
                          className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left hover:bg-[#f7f7f8]"
                        >
                          <Icon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              connector && on ? 'text-emerald-600' : 'text-[#1a1a1a]'
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-[#1a1a1a]">{label}</span>
                            <span className="block text-[10px] text-[#6b6b6b]">{hint}</span>
                          </span>
                          {/* A connector shows its state and is the control
                              that changes it. Reading it and toggling it are
                              the same affordance, so there is no way to be
                              unsure whether the click connected or scanned. */}
                          {connector && (
                            <span
                              aria-hidden="true"
                              className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                                on ? 'bg-emerald-600' : 'bg-[#d8d2c4]'
                              }`}
                            >
                              <span
                                className={`h-3 w-3 rounded-full bg-white transition-transform ${
                                  on ? 'translate-x-3' : 'translate-x-0'
                                }`}
                              />
                            </span>
                          )}
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
                className={`inline-flex h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors ${
                  webSearch
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#6b6b6b] hover:bg-[#f7f7f8]'
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
                className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-sm text-[#1a1a1a] placeholder:text-[#6b6b6b] focus:shadow-none focus:outline-hidden"
              />
              <button
                id="send-followup-btn"
                type="submit"
                disabled={isGenerating || !followUpInput.trim()}
                className="inline-flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#1a1a1a] text-white transition-colors hover:bg-[#000000] disabled:bg-[#e5e5e5] disabled:text-[#6b6b6b]"
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
