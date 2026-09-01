import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
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
} from 'lucide-react';
import {
  JournalEntry,
  TurnMessage,
  MoodType,
  CategoryType,
  ReflectionMode,
} from '../types';
import { requestReflection, requestSummary } from '../lib/geminiApi';

interface JournalEditorProps {
  entry: JournalEntry;
  onSave: (updatedEntry: JournalEntry) => Promise<void>;
  onDelete?: (entryId: string) => void;
  isSaving: boolean;
  saveError: string | null;
  lastSavedAt: string | null;
}

const CATEGORIES: CategoryType[] = [
  'Personal',
  'Career & Ambition',
  'Mindfulness & Gratitude',
  'Ideas & Brainstorming',
  'Relationships',
  'Learning',
];

const MOODS: { type: MoodType; label: string; icon: string }[] = [
  { type: 'Reflective', label: 'Reflective', icon: '🤔' },
  { type: 'Grateful', label: 'Grateful', icon: '🙏' },
  { type: 'Energized', label: 'Energized', icon: '⚡' },
  { type: 'Calm', label: 'Calm', icon: '🌿' },
  { type: 'Curious', label: 'Curious', icon: '💡' },
  { type: 'Stressed', label: 'Stressed', icon: '🌪️' },
  { type: 'Determined', label: 'Determined', icon: '🎯' },
  { type: 'Overwhelmed', label: 'Overwhelmed', icon: '🌊' },
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
  onDelete,
  isSaving,
  saveError,
  lastSavedAt,
}) => {
  // Local state initialized from entry
  const [title, setTitle] = useState(entry.title || '');
  const [content, setContent] = useState(entry.content || '');
  const [category, setCategory] = useState<CategoryType>(entry.category || 'Personal');
  const [mood, setMood] = useState<MoodType>(entry.mood || 'Reflective');
  const [mode, setMode] = useState<ReflectionMode>(entry.mode || 'companion');
  const [turns, setTurns] = useState<TurnMessage[]>(entry.turns || []);
  const [summary, setSummary] = useState<string | undefined>(entry.summary);
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

  const turnsEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Sync state when active entry prop changes
  useEffect(() => {
    setTitle(entry.title || '');
    setContent(entry.content || '');
    setCategory(entry.category || 'Personal');
    setMood(entry.mood || 'Reflective');
    setMode(entry.mode || 'companion');
    setTurns(entry.turns || []);
    setSummary(entry.summary);
    setInsights(entry.insights);
    setTags(entry.tags);
    setSentiment(entry.sentiment);
    setHasUnsavedChanges(false);
    setErrorMsg(null);
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

  // Helper to compile current entry object
  const getCurrentEntryObject = (): JournalEntry => ({
    ...entry,
    title: title.trim() || 'Untitled Reflection',
    content,
    category,
    mood,
    mode,
    turns,
    summary,
    insights,
    tags,
    sentiment,
    updatedAt: new Date().toISOString(),
  });

  // Handle Save
  const handleSave = async () => {
    setErrorMsg(null);
    try {
      const updated = getCurrentEntryObject();
      await onSave(updated);
      setHasUnsavedChanges(false);
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

      const response = await requestReflection({
        content: userPrompt,
        mode,
        mood,
        category,
        turns: updatedTurns,
      });

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
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gemini reflection request failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Follow-up in Multi-Turn dialogue
  const handleSendFollowUp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!followUpInput.trim() || isGenerating) return;

    const followUpText = followUpInput.trim();
    setFollowUpInput('');
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

      const response = await requestReflection({
        content: content.trim(),
        mode,
        mood,
        category,
        turns: updatedTurns,
      });

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
      `**Date:** ${new Date(entry.createdAt).toLocaleDateString()} | **Category:** ${category} | **Mood:** ${mood}`,
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

        {/* Category & Mood metadata pills */}
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

          {/* Mood Selector */}
          <div className="flex items-center gap-1.5 ml-2">
            <Smile className="h-3.5 w-3.5 text-[#8a8a75]" />
            <select
              id="mood-select"
              value={mood}
              onChange={(e) => {
                setMood(e.target.value as MoodType);
                setHasUnsavedChanges(true);
              }}
              className="rounded-md border border-[#e5e0d3] bg-white px-2 py-1 text-xs font-medium text-[#434338] focus:border-[#5a5a40] focus:outline-hidden"
            >
              {MOODS.map((m) => (
                <option key={m.type} value={m.type}>
                  {m.icon} {m.label}
                </option>
              ))}
            </select>
          </div>

          {sentiment && (
            <span className="ml-auto rounded-full bg-[#f3efe6] border border-[#e5e0d3] px-2.5 py-0.5 text-[11px] font-medium text-[#5a5a40]">
              Sentiment: {sentiment}
            </span>
          )}
        </div>
      </div>

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

      {/* Main Content Area */}
      <div className="flex-1 p-4 sm:p-6 max-w-4xl w-full mx-auto space-y-6">
        {/* Reflection Mode Card */}
        <div className="rounded-2xl border border-[#e5e0d3] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#8a8a75]">
              Select Gemini Reflection Style
            </label>
            <span className="text-[11px] text-[#8a8a75]">Powered by Gemini 3.6 Flash</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const isSelected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMode(m.id);
                    setHasUnsavedChanges(true);
                  }}
                  className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#5a5a40] bg-[#5a5a40] text-white shadow-xs'
                      : 'border-[#e5e0d3] bg-[#fcfaf7] text-[#434338] hover:bg-[#f3efe6]'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 mb-1.5 ${
                      isSelected ? 'text-amber-200' : 'text-[#5a5a40]'
                    }`}
                  />
                  <div className="font-medium text-xs truncate w-full">{m.name}</div>
                  <div
                    className={`text-[10px] mt-0.5 line-clamp-1 ${
                      isSelected ? 'text-[#e5e0d3]' : 'text-[#8a8a75]'
                    }`}
                  >
                    {m.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary Journal Writing Area */}
        <div className="rounded-2xl border border-[#e5e0d3] bg-white p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-xs text-[#8a8a75]">
            <span className="font-medium text-[#2c2c24]">Your Reflection & Journal Entry</span>
            <div className="flex items-center gap-3">
              <span>
                {wordCount} words &bull; {charCount} chars
              </span>
              <button
                type="button"
                onClick={toggleSpeech}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  isListening
                    ? 'bg-red-100 text-red-700 animate-pulse'
                    : 'bg-[#f3efe6] text-[#5a5a40] border border-[#e5e0d3] hover:bg-[#e5e0d3]'
                }`}
                title="Voice dictation"
              >
                {isListening ? (
                  <>
                    <MicOff className="h-3 w-3" />
                    <span>Listening...</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-3 w-3" />
                    <span>Dictate</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <textarea
            id="journal-content-textarea"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setHasUnsavedChanges(true);
            }}
            placeholder="Write down what is on your mind, what challenged you today, a decision you are wrestling with, or something you are grateful for..."
            rows={7}
            className="w-full rounded-xl border border-[#e5e0d3] bg-[#fdfcf9] p-3.5 text-sm sm:text-base leading-relaxed text-[#2c2c24] placeholder:text-[#8a8a75] focus:border-[#5a5a40] focus:outline-hidden resize-y font-sans"
          />

          {/* Primary Action Trigger Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <button
                id="reflect-gemini-btn"
                type="button"
                onClick={handleReflectWithGemini}
                disabled={isGenerating || !content.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#5a5a40] px-4 py-2.5 text-xs sm:text-sm font-medium text-white shadow-xs hover:bg-[#484833] focus:outline-hidden disabled:opacity-50 transition-colors cursor-pointer"
              >
                {isGenerating ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-200" />
                ) : (
                  <Sparkles className="h-4 w-4 text-amber-200" />
                )}
                <span>
                  {isGenerating ? 'Gemini is reflecting...' : 'Reflect with Gemini'}
                </span>
              </button>

              <button
                id="synthesize-summary-btn"
                type="button"
                onClick={handleGenerateSummary}
                disabled={isSummarizing || (!content.trim() && turns.length === 0)}
                className="inline-flex items-center gap-2 rounded-xl border border-[#e5e0d3] bg-[#f3efe6] px-3.5 py-2.5 text-xs sm:text-sm font-medium text-[#434338] hover:bg-[#e5e0d3] focus:outline-hidden disabled:opacity-50 transition-colors cursor-pointer"
              >
                {isSummarizing ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-[#5a5a40]" />
                ) : (
                  <FileText className="h-4 w-4 text-[#5a5a40]" />
                )}
                <span>
                  {isSummarizing ? 'Synthesizing...' : 'Extract Summary & Insights'}
                </span>
              </button>
            </div>

            {turns.length > 0 && (
              <span className="text-xs text-[#8a8a75]">
                {turns.length} exchange{turns.length === 1 ? '' : 's'} recorded
              </span>
            )}
          </div>
        </div>

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

        {/* Multi-Turn Conversation History */}
        {turns.length > 0 && (
          <div className="rounded-2xl border border-[#e5e0d3] bg-white p-5 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-[#f0ede6] pb-3">
              <h3 className="font-serif text-base font-semibold text-[#2c2c24] flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#5a5a40]" />
                <span>Multi-Turn Reflection Dialogue</span>
              </h3>
              <span className="text-xs text-[#8a8a75]">
                Isolated in Firestore Subcollection
              </span>
            </div>

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
                        <div className="prose prose-stone prose-sm max-w-none text-[#2c2c24]">
                          <ReactMarkdown>{turn.text}</ReactMarkdown>
                        </div>
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

            {/* Follow-up input box */}
            <form
              onSubmit={handleSendFollowUp}
              className="mt-4 pt-3 border-t border-[#f0ede6] flex items-center gap-2"
            >
              <input
                id="followup-input"
                type="text"
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                placeholder="Ask a follow-up question, add a thought, or request another angle..."
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
