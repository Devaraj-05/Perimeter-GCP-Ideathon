import React from 'react';
import {
  Database, Lock, Server, KeyRound, ShieldCheck, Eye, Ban, ScrollText, FlaskConical,
} from 'lucide-react';
import { PageShell } from './PageShell';

/**
 * Security and isolation — the architecture page.
 *
 * Public. It was a modal on the signed-out landing page as well as inside the
 * workspace, and it stays reachable without an account: it is the part of the
 * pitch a reviewer needs, and a page you must sign in to read is a page that
 * does not do its job.
 *
 * Static by construction — no props, no state, no fetch. Everything asserted
 * here is checkable against the repository, which is the only kind of security
 * claim worth printing.
 */

const LAYERS = [
  {
    Icon: Database,
    title: 'Owner-bound Firestore rules',
    body: 'Every document lives under your user ID, and the security rules deny read and write to every other account. The server resolves your identity from a verified Firebase token on each request — never from a path, a request body, or anything a model produced.',
    code: 'allow read, write: if request.auth.uid == userId;',
  },
  {
    Icon: Lock,
    title: 'Federated sign-in, no password handling',
    body: 'Google Sign-In through Firebase Auth. Credential storage, rotation and breach response are handled by the identity provider rather than reimplemented here — the safest password database is one this application never has.',
  },
  {
    Icon: Server,
    title: 'Keys stay on the server',
    body: 'The Gemini key and the GitHub token are held in Secret Manager and injected into Cloud Run as environment variables with a single scoped IAM binding each. Neither is ever sent to the browser, and no model call is made from the client.',
  },
  {
    Icon: KeyRound,
    title: 'Encrypted connection tokens',
    body: 'Gmail and GitHub OAuth tokens are sealed with AES-256-GCM before they touch the database, and they are excluded even from your own data export — an export is a file, and a live token inside one is still a live token.',
  },
];

const INVARIANTS = [
  {
    Icon: Eye,
    id: 'INV-1',
    title: 'The reader holds no tools',
    body: 'The model that reads your untrusted documents has no function declarations bound to it at all. An instruction hidden in a PDF can be perfectly persuasive and still have nothing to call.',
  },
  {
    Icon: Ban,
    id: 'INV-5',
    title: 'A tainted turn cannot write',
    body: 'If untrusted content entered the context, any proposal that writes or sends is refused by the broker — not softened, not confirmed. Refused.',
  },
  {
    Icon: ShieldCheck,
    id: 'INV-4',
    title: 'Default deny at the boundary',
    body: 'No tool with a side effect runs without a live capability grant matching your user, that tool and that resource. Read-only tools scoped to your own data need no grant; everything else is denied until you say otherwise.',
  },
  {
    Icon: ScrollText,
    id: 'INV-15',
    title: 'The log is tamper-evident',
    body: 'Every decision is appended to a hash-chained log. Removing or editing an entry breaks the chain, and the verification is something you can run yourself from the app.',
  },
];

export const SecurityPage: React.FC = () => (
  <PageShell
    title="Security and isolation"
    subtitle="How this application reads hostile documents without becoming one. Every claim here is checkable against the source."
  >
    {/* The architecture, first — the thing that makes the rest possible. */}
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">
        The airlock
      </h2>
      <div className="mt-5 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div>
          <p className="font-serif text-2xl font-normal leading-[1.25] tracking-[-0.02em] text-[#1a1a1a] sm:text-3xl">
            The model that reads your world is not the model that can act on it.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[#525252]">
            Prompt injection works because one model both reads attacker-controlled text and holds
            the tools. Split those two jobs and the attack has nowhere to land: the document reaches
            a reader with no tools, which emits a fixed JSON shape describing what it saw. The
            planner — which does hold tools — never sees the document, only that description. A
            sentence commanding obedience arrives as a string in a field called{' '}
            <code className="rounded bg-[#f7f7f8] px-1.5 py-0.5 font-mono text-xs">
              instruction_attempt_excerpt
            </code>
            , which is data about an attack rather than an instruction to follow.
          </p>
        </div>

        <ol className="space-y-0 divide-y divide-[#f0f0f0] border-y border-[#e5e5e5]">
          {[
            ['Untrusted document', 'An email, a page, a PDF, a repository file.'],
            ['Reader — no tools bound', 'Reads it. Cannot call anything, however asked.'],
            ['Typed JSON observation', 'A fixed shape. Not prose, not a passthrough.'],
            ['Planner — holds tools', 'Sees the observation. Never the document.'],
            ['Broker', 'Decides. Default deny; a tainted turn cannot write.'],
          ].map(([step, detail], i) => (
            <li key={step} className="flex gap-4 py-3.5">
              <span className="mt-0.5 font-mono text-xs tabular-nums text-[#6b6b6b]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#1a1a1a]">{step}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#6b6b6b]">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>

    <section className="mt-16">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">
        Data and credentials
      </h2>
      {/* Two columns of two, not a three-up card row: these are four peers and
          they need reading room more than they need tiling. */}
      <div className="mt-5 grid gap-x-12 gap-y-8 sm:grid-cols-2">
        {LAYERS.map(({ Icon, title, body, code }) => (
          <div key={title} className="border-t border-[#e5e5e5] pt-5">
            <p className="flex items-center gap-2.5 text-sm font-semibold text-[#1a1a1a]">
              <Icon className="h-4 w-4 shrink-0" />
              {title}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#525252]">{body}</p>
            {code && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-[#f7f7f8] p-3 font-mono text-[11px] text-[#1a1a1a]">
                {code}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>

    <section className="mt-16">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">
        Absolutes, not best efforts
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#525252]">
        These are properties of the architecture rather than instructions to a model. A model can be
        talked out of an instruction; it cannot be talked into holding a tool it was never given.
      </p>
      <ul className="mt-5 divide-y divide-[#f0f0f0] border-y border-[#e5e5e5]">
        {INVARIANTS.map(({ Icon, id, title, body }) => (
          <li key={id} className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-5">
            <span className="flex shrink-0 items-center gap-2 sm:w-32">
              <Icon className="h-4 w-4 shrink-0 text-[#1a1a1a]" />
              <span className="font-mono text-xs text-[#6b6b6b]">{id}</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#1a1a1a]">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-[#525252]">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>

    <section className="mt-16">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">
        Availability
      </h2>
      <div className="mt-5 border-t border-[#e5e5e5] pt-5">
        <p className="flex items-center gap-2.5 text-sm font-semibold text-[#1a1a1a]">
          <FlaskConical className="h-4 w-4 shrink-0" />
          A fallback ladder, not a single model string
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#525252]">
          Recoverable failures — 503, 429, 404, 500 — move to the next model rather than surfacing an
          error. Each attempt carries its own timeout so one stalled call cannot consume the whole
          request budget.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-[#f7f7f8] p-3 font-mono text-[11px] text-[#1a1a1a]">
          gemini-3.6-flash → gemini-3.1-flash-lite → gemini-flash-latest → gemini-3.7-flash
        </pre>
      </div>
    </section>

    <p className="mt-16 border-t border-[#e5e5e5] pt-6 text-xs leading-relaxed text-[#6b6b6b]">
      Nothing on this page is a promise about a model’s behaviour. Each item is a structural
      property — a tool that is not bound, a rule that denies by default, a chain that breaks when
      edited — and each one is visible in the repository.
    </p>
  </PageShell>
);
