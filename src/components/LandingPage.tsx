import React, { useState } from 'react';
import { Shield, Lock, BrainCircuit, ScrollText, CheckCircle2, Mail } from 'lucide-react';

interface LandingPageProps {
  onSignIn: () => void;
  /**
   * Email and password — a deliberate deviation from Directive 3, made at the
   * project owner's instruction after the conflict was raised. Google sign-in
   * stays and is still presented first. See src/lib/firebase.ts for what is
   * and is not true about the implementation.
   */
  onEmailSignIn: (email: string, password: string) => void;
  onEmailSignUp: (email: string, password: string) => void;
  onPasswordReset: (email: string) => void;
  isLoading: boolean;
  error: string | null;
  notice?: string | null;
}

const PILLARS = [
  {
    Icon: BrainCircuit,
    title: 'Reflect with Gemini',
    body: 'Multi-turn journalling across five modes. Every entry stays isolated to your own account in Cloud Firestore.',
    foot: 'Five reflection modes',
  },
  {
    Icon: Shield,
    title: 'A boundary the model cannot cross',
    body: 'External content is read by a model with no tools bound. An injected instruction lands with nothing to call.',
    foot: 'The airlock, enforced in code',
  },
  {
    Icon: ScrollText,
    title: 'Visible, and verifiable',
    body: 'Every decision is written to a tamper-evident chain. See what was refused, and verify the log in one click.',
    foot: 'Hash-chained audit log',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onSignIn,
  onEmailSignIn,
  onEmailSignUp,
  onPasswordReset,
  isLoading,
  error,
  notice,
}) => {
  const [showEmail, setShowEmail] = useState(false);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim()) return setLocalError('Enter your email address.');
    if (!password) return setLocalError('Enter a password.');

    if (mode === 'up') {
      // Checked here so the user is told before a round trip. Firebase
      // enforces its own minimum regardless; this is the courtesy, not the
      // control.
      if (password.length < 6) return setLocalError('Passwords need at least 6 characters.');
      if (password !== confirm) return setLocalError('The two passwords do not match.');
      onEmailSignUp(email, password);
      return;
    }
    onEmailSignIn(email, password);
  };

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col justify-between bg-[#fcfaf7] text-[#434338]">
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <div className="anim-rise inline-flex items-center gap-2 rounded-full border border-[#e5e0d3] bg-[#f3efe6] px-3.5 py-1.5 text-xs font-medium text-[#5a5a40]">
            <Shield className="h-3.5 w-3.5" />
            <span>Perimeter — a journal that reads your untrusted world safely</span>
          </div>

          <h1 className="anim-rise anim-rise-1 font-serif text-[2.1rem] font-normal leading-[1.12] tracking-tight text-[#2c2c24] sm:text-5xl lg:text-[3.5rem]">
            Journal with an AI that reads your world,
            <span className="block text-[#5a5a40]">and can&rsquo;t be hijacked by it.</span>
          </h1>

          <p className="anim-rise anim-rise-2 mx-auto max-w-xl text-base leading-relaxed text-[#5a5a40] sm:text-lg">
            Reflect with Gemini, bring in the articles and repositories on your mind, and watch every
            attempt to hijack the assistant get refused, live.
          </p>

          <div className="anim-rise anim-rise-3 flex flex-col items-center gap-3 pt-2">
            <button
              id="google-signin-btn"
              onClick={onSignIn}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-3 rounded-xl bg-[#5a5a40] px-6 py-3.5 text-sm font-medium text-white shadow-[0_6px_20px_rgba(58,53,40,0.16)] transition-colors hover:bg-[#484833] disabled:opacity-60 sm:text-base"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z" />
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                </svg>
              )}
              <span>{isLoading ? 'Signing in…' : 'Sign in with Google'}</span>
            </button>

            {/* Email and password.
                Behind a disclosure so federated sign-in stays the default
                path, which is what Directive 3 prescribes. The password never
                leaves this form: it is handed to the Firebase SDK and is not
                stored, logged, or sent to our own server. */}
            {!showEmail ? (
              <button
                type="button"
                onClick={() => setShowEmail(true)}
                className="inline-flex items-center gap-2 text-xs text-[#5a5a40] underline underline-offset-4 hover:text-[#2c2c24]"
              >
                <Mail className="h-3.5 w-3.5" />
                Use an email address instead
              </button>
            ) : (
              <form
                onSubmit={submit}
                className="w-full max-w-sm space-y-2.5 rounded-xl border border-[#e5e0d3] bg-white/70 p-4 text-left"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-[#2c2c24]">
                    {mode === 'in' ? 'Sign in with email' : 'Create an account'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setMode(mode === 'in' ? 'up' : 'in');
                      setLocalError(null);
                    }}
                    className="cursor-pointer text-[11px] text-[#5a5a40] underline underline-offset-2 hover:text-[#2c2c24]"
                  >
                    {mode === 'in' ? 'Need an account?' : 'Already have one?'}
                  </button>
                </div>

                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-sm text-[#2c2c24] placeholder:text-[#8a8a75] focus:border-[#5a5a40] focus:outline-hidden"
                />

                <input
                  type="password"
                  autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-sm text-[#2c2c24] placeholder:text-[#8a8a75] focus:border-[#5a5a40] focus:outline-hidden"
                />

                {mode === 'up' && (
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-sm text-[#2c2c24] placeholder:text-[#8a8a75] focus:border-[#5a5a40] focus:outline-hidden"
                  />
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full cursor-pointer rounded-lg bg-[#5a5a40] px-4 py-2 text-sm font-medium text-white hover:bg-[#484833] disabled:opacity-60"
                >
                  {isLoading
                    ? 'Working…'
                    : mode === 'in'
                      ? 'Sign in'
                      : 'Create account'}
                </button>

                <div className="flex items-center justify-between pt-0.5">
                  {mode === 'in' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLocalError(null);
                        if (!email.trim()) return setLocalError('Enter your email first.');
                        onPasswordReset(email);
                      }}
                      className="cursor-pointer text-[11px] text-[#8a8a75] underline underline-offset-2 hover:text-[#5a5a40]"
                    >
                      Forgot password
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => setShowEmail(false)}
                    className="cursor-pointer text-[11px] text-[#8a8a75] underline underline-offset-2 hover:text-[#5a5a40]"
                  >
                    Back to Google
                  </button>
                </div>

                {localError && (
                  <p role="alert" className="text-[11px] text-rose-700">
                    {localError}
                  </p>
                )}
              </form>
            )}

            {notice && (
              <div
                role="status"
                className="max-w-md rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-left text-xs text-emerald-800"
              >
                {notice}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex max-w-md items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-left text-xs text-rose-700"
              >
                <span className="font-semibold">Authentication error:</span>
                <span>{error}</span>
              </div>
            )}

            <p className="flex items-center gap-1.5 text-xs text-[#8a8a75]">
              <Lock className="h-3 w-3" />
              <span>
                Google sign-in is federated and handles no credential here. If you use email,
                Firebase Authentication holds the password &mdash; this application never stores it.
              </span>
            </p>
          </div>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-3">
          {PILLARS.map(({ Icon, title, body, foot }, i) => (
            <div
              key={title}
              className={`anim-rise anim-rise-${i + 1} flex flex-col justify-between rounded-2xl border border-[#e5e0d3] bg-white p-6 shadow-[0_1px_2px_rgba(58,53,40,0.06)]`}
            >
              <div className="space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e5e0d3] bg-[#f3efe6] text-[#5a5a40]">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-lg font-medium text-[#2c2c24]">{title}</h3>
                <p className="text-sm leading-relaxed text-[#434338]">{body}</p>
              </div>
              <div className="mt-4 flex items-center gap-1.5 border-t border-[#f0ede6] pt-4 text-xs text-[#8a8a75]">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#5a5a40]" />
                <span>{foot}</span>
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-[#e5e0d3] bg-white py-5">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-center text-xs text-[#8a8a75] sm:flex-row">
          <span>Perimeter · Firebase Auth · Cloud Firestore · Gemini · Google Cloud Run</span>
          <span>Owner-bound data, server-verified, tamper-evident by design.</span>
        </div>
      </footer>
    </div>
  );
};
