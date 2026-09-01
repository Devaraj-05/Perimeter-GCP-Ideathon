import React from 'react';
import { Sparkles, Shield, Lock, BrainCircuit, MessageSquareText, Compass, CheckCircle2 } from 'lucide-react';

interface LandingPageProps {
  onSignIn: () => void;
  isLoading: boolean;
  error: string | null;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn, isLoading, error }) => {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-between bg-[#fcfaf7] text-[#434338]">
      {/* Main Hero */}
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-12 pb-16">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#e5e0d3] bg-[#f3efe6] px-3.5 py-1.5 text-xs font-medium text-[#5a5a40] shadow-2xs">
            <Sparkles className="h-3.5 w-3.5 text-[#5a5a40]" />
            <span>Private Multi-Turn Reflection & Journal Companion</span>
          </div>

          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-normal tracking-tight text-[#2c2c24] leading-[1.15]">
            Unpack your thoughts with an intelligent companion.
          </h1>

          <p className="text-base sm:text-lg text-[#5a5a40] leading-relaxed font-sans max-w-2xl mx-auto">
            Write uninhibited reflections, brainstorm solutions, and converse with Gemini 3.6 Flash.
            Every entry is securely encrypted and isolated strictly to your authenticated account in Cloud Firestore.
          </p>

          {/* Sign In CTA */}
          <div className="pt-4 flex flex-col items-center gap-3">
            <button
              id="google-signin-btn"
              onClick={onSignIn}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-3 rounded-xl bg-[#5a5a40] px-6 py-3.5 text-sm sm:text-base font-medium text-white shadow-md hover:bg-[#484833] focus:outline-hidden focus:ring-2 focus:ring-[#8a8a75] disabled:opacity-60 transition-all cursor-pointer"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
              )}
              <span>{isLoading ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-700 max-w-md text-left flex items-start gap-2">
                <span className="font-semibold">Authentication Error:</span>
                <span>{error}</span>
              </div>
            )}

            <p className="text-xs text-[#8a8a75] flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-[#8a8a75]" />
              <span>Passwordless Google Authentication via Firebase Auth. No passwords stored.</span>
            </p>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-[#e5e0d3] bg-white p-6 shadow-2xs flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f3efe6] text-[#5a5a40] border border-[#e5e0d3]">
                <BrainCircuit className="h-5 w-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-[#2c2c24]">
                Multi-Turn Gemini 3.6 Dialogue
              </h3>
              <p className="text-sm text-[#434338] leading-relaxed">
                Beyond static notes: carry on an active conversation to unpack challenges, explore Socratic questions, or brainstorm creative solutions.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-[#f0ede6] text-xs text-[#8a8a75] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#5a5a40]" />
              <span>5 Reflection Modes included</span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#e5e0d3] bg-white p-6 shadow-2xs flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f3efe6] text-[#5a5a40] border border-[#e5e0d3]">
                <Shield className="h-5 w-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-[#2c2c24]">
                Strict Cloud Firestore Isolation
              </h3>
              <p className="text-sm text-[#434338] leading-relaxed">
                Protected by strict owner-only security rules (<code className="text-xs bg-[#f3efe6] text-[#5a5a40] px-1 py-0.5 rounded border border-[#e5e0d3]">request.auth.uid == userId</code>). Zero cross-user data leakage.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-[#f0ede6] text-xs text-[#8a8a75] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#5a5a40]" />
              <span>Full CRUD with client-side zero undefined hygiene</span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#e5e0d3] bg-white p-6 shadow-2xs flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f3efe6] text-[#5a5a40] border border-[#e5e0d3]">
                <Compass className="h-5 w-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-[#2c2c24]">
                Executive Synthesis & Insights
              </h3>
              <p className="text-sm text-[#434338] leading-relaxed">
                Generate structured 2-sentence summaries, key takeaway bullet points, mood tracking, and sentiment classifications with one click.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-[#f0ede6] text-xs text-[#8a8a75] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#5a5a40]" />
              <span>Exportable Markdown & Searchable History</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e5e0d3] bg-white py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-[#8a8a75] flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>ReflectAI &bull; Google AI Studio Powered &bull; Gemini 3.6 Flash & Cloud Firestore</span>
          <span>End-to-end authenticated with Firebase Security Rules</span>
        </div>
      </footer>
    </div>
  );
};
