import React from 'react';
import { Reveal } from './Reveal';

/**
 * The airlock, drawn.
 *
 * This is the section the landing page did not have, and it is the only one
 * that explains why the product exists. Every other AI journal reads your
 * documents; the claim here is about WHERE the reading happens relative to the
 * tools, and that is a shape, not a sentence.
 *
 * Inline SVG rather than an image or a library: it inherits the palette, stays
 * sharp at any size, costs no request, and can carry a real title and
 * description for anyone who cannot see it.
 */

const STEPS = [
  {
    n: '1',
    title: 'Something untrusted arrives',
    body: 'An email, a web page, a PDF, a repository. Anything you did not type yourself.',
  },
  {
    n: '2',
    title: 'The Reader looks at it, holding no tools',
    body: 'A model reads the document and returns typed observations. It has no functions bound to it, so an instruction inside the document has nothing to call.',
  },
  {
    n: '3',
    title: 'The Planner sees observations, never the text',
    body: 'The model that can act receives structured findings, not the attacker’s prose. It cannot be argued with by a document it never read.',
  },
  {
    n: '4',
    title: 'The Broker decides, before anything runs',
    body: 'A pure function checks the grant, the taint and the limits, writes the decision to an append-only log, and only then does anything execute.',
  },
];

export const HowItWorks: React.FC = () => (
  <section id="how-it-works" className="border-t border-[#e5e5e5] bg-white py-20 sm:py-28">
    <div className="mx-auto max-w-5xl px-6">
      <Reveal>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">
          How it works
        </p>
        <h2 className="mt-3 font-serif text-3xl font-normal leading-[1.15] tracking-[-0.02em] text-[#1a1a1a] sm:text-4xl">
          The model that reads your world
          <br className="hidden sm:block" /> is not the model that can act on it.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#525252]">
          Most defences try to detect a malicious instruction. This one assumes detection will
          sometimes fail, and removes the capability instead.
        </p>
      </Reveal>

      <Reveal delay={1} className="mt-12">
        <figure>
          <svg
            viewBox="0 0 900 216"
            className="w-full"
            role="img"
            aria-labelledby="airlock-t airlock-d"
          >
            <title id="airlock-t">The Perimeter airlock</title>
            <desc id="airlock-d">
              An untrusted document flows into a Reader model that holds no tools. The Reader emits
              typed observations, which flow to a Planner model that holds the tools. The Planner
              proposes a tool call, which a Broker allows or denies before anything executes. The
              raw document text never reaches the Planner.
            </desc>

            <defs>
              <marker
                id="pm-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0 0 10 5 0 10z" fill="#6b6b6b" />
              </marker>
            </defs>

            <rect x="4" y="34" width="196" height="142" rx="14" fill="#fdf2f2" stroke="#f0c9c9" />
            <text x="102" y="60" textAnchor="middle" fill="#9f3f3f" fontSize="11" fontWeight="600">
              UNTRUSTED
            </text>
            <text x="102" y="96" textAnchor="middle" fill="#1a1a1a" fontSize="14" fontWeight="600">
              A document
            </text>
            <text x="102" y="119" textAnchor="middle" fill="#6b6b6b" fontSize="11">
              email, page, PDF,
            </text>
            <text x="102" y="135" textAnchor="middle" fill="#6b6b6b" fontSize="11">
              repository
            </text>

            <line
              x1="204"
              y1="105"
              x2="252"
              y2="105"
              stroke="#6b6b6b"
              strokeWidth="1.5"
              markerEnd="url(#pm-arrow)"
            />

            <rect x="256" y="34" width="180" height="142" rx="14" fill="#fafafa" stroke="#e5e5e5" />
            <text x="346" y="60" textAnchor="middle" fill="#6b6b6b" fontSize="11" fontWeight="600">
              READER
            </text>
            <text x="346" y="96" textAnchor="middle" fill="#1a1a1a" fontSize="14" fontWeight="600">
              Holds no tools
            </text>
            <text x="346" y="122" textAnchor="middle" fill="#1a1a1a" fontSize="11">
              reads the text,
            </text>
            <text x="346" y="138" textAnchor="middle" fill="#1a1a1a" fontSize="11">
              returns typed JSON
            </text>

            <line
              x1="440"
              y1="105"
              x2="488"
              y2="105"
              stroke="#6b6b6b"
              strokeWidth="1.5"
              markerEnd="url(#pm-arrow)"
            />
            <text x="466" y="92" textAnchor="middle" fill="#6b6b6b" fontSize="10">
              findings
            </text>

            <rect x="492" y="34" width="180" height="142" rx="14" fill="#f7f7f8" stroke="#d4d4d4" />
            <text x="582" y="60" textAnchor="middle" fill="#1a1a1a" fontSize="11" fontWeight="600">
              PLANNER
            </text>
            <text x="582" y="96" textAnchor="middle" fill="#1a1a1a" fontSize="14" fontWeight="600">
              Holds the tools
            </text>
            <text x="582" y="122" textAnchor="middle" fill="#1a1a1a" fontSize="11">
              never sees the
            </text>
            <text x="582" y="138" textAnchor="middle" fill="#1a1a1a" fontSize="11">
              raw document
            </text>

            <line
              x1="676"
              y1="105"
              x2="724"
              y2="105"
              stroke="#6b6b6b"
              strokeWidth="1.5"
              markerEnd="url(#pm-arrow)"
            />

            <rect x="728" y="34" width="168" height="142" rx="14" fill="#1a1a1a" />
            <text x="812" y="60" textAnchor="middle" fill="#a3a3a3" fontSize="11" fontWeight="600">
              BROKER
            </text>
            <text x="812" y="96" textAnchor="middle" fill="#ffffff" fontSize="14" fontWeight="600">
              Allow or deny
            </text>
            <text x="812" y="122" textAnchor="middle" fill="#a3a3a3" fontSize="11">
              logged before
            </text>
            <text x="812" y="138" textAnchor="middle" fill="#a3a3a3" fontSize="11">
              anything runs
            </text>

            <line
              x1="466"
              y1="16"
              x2="466"
              y2="192"
              stroke="#c94f4f"
              strokeWidth="1.5"
              strokeDasharray="5 5"
            />
            <text x="466" y="208" textAnchor="middle" fill="#9f3f3f" fontSize="10" fontWeight="600">
              raw text stops here
            </text>
          </svg>
        </figure>
      </Reveal>

      <div className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={(i % 3) as 0 | 1 | 2}>
            <div className="flex gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#e5e5e5] bg-[#fafafa] text-xs font-semibold text-[#1a1a1a]">
                {s.n}
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-[#1a1a1a]">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#525252]">{s.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);
