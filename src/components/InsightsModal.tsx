import React from 'react';
import { X, BarChart3, Sparkles, Heart, BrainCircuit, CheckCircle2 } from 'lucide-react';
import { JournalEntry } from '../types';

interface InsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: JournalEntry[];
}

export const InsightsModal: React.FC<InsightsModalProps> = ({
  isOpen,
  onClose,
  entries,
}) => {
  if (!isOpen) return null;

  // Calculate metrics
  const totalEntries = entries.length;
  const totalWords = entries.reduce(
    (acc, e) => acc + (e.content ? e.content.trim().split(/\s+/).length : 0),
    0
  );
  const totalTurns = entries.reduce(
    (acc, e) => acc + (e.turns ? e.turns.length : 0),
    0
  );

  // Category counts
  const catCounts: { [k: string]: number } = {};
  entries.forEach((e) => {
    catCounts[e.category] = (catCounts[e.category] || 0) + 1;
  });

  // Collect all actionable takeaways
  const allInsights: string[] = [];
  entries.forEach((e) => {
    if (e.insights) {
      e.insights.forEach((ins) => allInsights.push(ins));
    }
  });

  return (
    <div className="fixed inset-0 z-50 anim-backdrop flex items-center justify-center bg-[#1a1a1a]/50 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#ffffff] p-6 shadow-xl border border-[#e5e5e5] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f7f7f8] border border-[#e5e5e5] text-[#1a1a1a]">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#1a1a1a]">
                Reflection Trends & Insights
              </h2>
              <p className="text-xs text-[#6b6b6b]">
                Synthesized across {totalEntries} journal entries
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#6b6b6b] hover:bg-[#f7f7f8] hover:text-[#1a1a1a] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Quick Stats Grid */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 text-center">
            <div className="text-2xl font-serif font-bold text-[#1a1a1a]">
              {totalEntries}
            </div>
            <div className="text-xs text-[#6b6b6b] mt-0.5">Reflections</div>
          </div>
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 text-center">
            <div className="text-2xl font-serif font-bold text-[#1a1a1a]">
              {totalWords}
            </div>
            <div className="text-xs text-[#6b6b6b] mt-0.5">Words Written</div>
          </div>
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 text-center">
            <div className="text-2xl font-serif font-bold text-[#1a1a1a]">
              {totalTurns}
            </div>
            <div className="text-xs text-[#6b6b6b] mt-0.5">Gemini Exchanges</div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="mt-6 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1a1a1a]">
            Top Journal Categories
          </h3>
          <div className="space-y-2">
            {Object.entries(catCounts).map(([cat, count]) => {
              const pct = totalEntries > 0 ? Math.round((count / totalEntries) * 100) : 0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-[#3f3f3f]">
                    <span>{cat}</span>
                    <span>
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#f7f7f8] border border-[#e5e5e5] overflow-hidden">
                    <div
                      className="h-full bg-[#1a1a1a] rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Key Takeaways */}
        {allInsights.length > 0 && (
          <div className="mt-6 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1a1a1a]">
              Recent Actionable Takeaways from Gemini
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {allInsights.slice(0, 6).map((ins, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-xl border border-[#e5e5e5] bg-white p-3 text-xs text-[#3f3f3f] leading-relaxed shadow-2xs"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>{ins}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-[#e5e5e5] flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-[#1a1a1a] px-4 py-2 text-xs font-medium text-white hover:bg-[#000000] cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
