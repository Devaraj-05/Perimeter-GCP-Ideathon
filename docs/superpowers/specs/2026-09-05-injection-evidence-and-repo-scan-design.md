# Showing the injection, not just naming it

**Date:** 2026-09-05 · **Status:** approved, not yet implemented

Perimeter classifies untrusted content and shows the user a coloured word: `HOSTILE`. It does
not show what was hostile, where it was, or what it asked for. That is a gap between the
product statement — *"shows you, live, every attempt that world makes to hijack its AI"* — and
what the screen actually does. A badge is a verdict, not evidence.

This spec covers four changes. Three close that gap. The fourth moves GitHub ingestion into the
chat composer and turns it into a repository-wide injection scan.

**Build order: E → A → B → C → D.** A precedes B because B renders A's output. E precedes
everything because §9 of the Constitution requires the amendment to land in its own commit
before the integration it governs. C is independent and can land any time.

**This spec becomes two implementation plans, not one.** Plan 1 is A + B + C — the evidence
work, which shares `detect.ts` and the composer and should be built and reviewed together.
Plan 2 is E + D — the repository scan, which is a new integration with its own amendment,
its own route and its own corpus payload. They are specified together because §D consumes §A's
`Match` type, and separating the specs would hide that dependency.

---

## Decisions taken before design

Three questions were settled up front because each one changes the shape of the work.

**Evidence is deterministic spans, not model prose.** The alternative — asking the Reader to
explain the attack — would render a poisoned document's own account of itself to the user as
Perimeter's security analysis. Evidence comes from regex match offsets, so no attacker-authored
sentence ever reaches the explanation.

**The repo scan reads the whole default-branch tree.** The narrower option (issues, README and
agent-instruction files only) was offered and rejected. Whole-tree scanning carries a real
false-positive cost — source code that mentions "ignore previous instructions" will fire
patterns — so the design manages it with a priority tier and honest coverage reporting rather
than pretending it does not exist.

**The repo scan is a security report and nothing else.** No Reader, no Planner, no artifacts, no
grounding. The user cannot ask follow-up questions about the repository, because that is not the
feature. This is what makes the strongest claim in the design available: the scanner cannot be
injected, because it does not think.

---

## The security constraint that shapes §B

**The "what would you like me to do?" prompt must never be model output.**

The model that reads a poisoned PDF is the same model that would compose the question. An
attacker who controls the document controls the question, and could produce:

> *"Shall I summarise this and send it to the address in the footer?"*

A user who has been told this application is safe clicks yes. That converts the airlock's safe
failure — an injection landing in a model with no tools — into a social-engineering channel
routed through Perimeter's own interface, carrying Perimeter's credibility.

Every ask-before-act affordance in this spec is therefore **fixed chrome**: string literals in
TSX, rendered unconditionally. Nothing a model emits can change what a button says, or whether
it appears.

---

## §A — `detect.ts` returns matches, not booleans

### Why

`detectL1` uses `.test()` throughout (`server/detect.ts:155-165`). It learns *that*
`instruction_override` fired and immediately discards *what matched and where*. The spans the UI
needs do not exist. This is the root cause of the bare `HOSTILE` badge, and no amount of UI work
fixes it upstream of here.

### Interface

Additive. Every existing field keeps its exact shape.

```ts
export interface Match {
  signal: Signal;
  /** Character offsets into the scanned text. */
  start: number;
  end: number;
  /** 1-based line number of `start`, for display. */
  line: number;
  /** The matched text plus context, with the match delimited. Capped (see below). */
  excerpt: string;
  /** True when the match is invisible when rendered (hidden_unicode, bidi_override). */
  hidden: boolean;
}

export interface L1Result {
  signals: Signal[];        // unchanged
  score: number;            // unchanged
  highConfidence: Signal[]; // unchanged
  matches: Match[];         // NEW
}
```

`fuseVerdict`, `scripts/replay-corpus.ts`, `server/redteam.ts`, `server/ingest.ts` and all 22
cases in `detect.test.ts` continue to work untouched. That is the point of making this additive:
this change must not be able to alter a verdict.

### Implementation notes

**Global regexes must not be shared.** The eleven pattern constants (`INSTRUCTION_OVERRIDE` …
`MARKDOWN_IMAGE_EXFIL`) are non-global today. A global `RegExp` carries mutable `lastIndex`, so a
module-level global pattern would leak scan position between calls and silently skip matches on
every second document. The canonical patterns stay non-global; the sweep builds a fresh
globalised clone per scan from `pattern.source` and `pattern.flags`.

**`findOffDomainUrls` changes shape.** It returns `boolean` today (`server/detect.ts:123`). It
becomes match-returning; the call site in `detectL1` becomes `matches.length > 0`.

**`FAKE_SYSTEM_ROLE` and `FAKE_SYSTEM_DIRECTIVE`** both map to the single `fake_system_role`
signal. Both are swept and their matches merged under that signal.

**Hidden characters need escaping to be visible.** `HIDDEN_UNICODE` and `BIDI_OVERRIDE` match
characters that render as nothing. An excerpt containing them is worthless as evidence — it looks
like ordinary text. Where `hidden` is true, the matched characters render as code points
(`U+202E`), not as themselves.

**Caps.** 20 matches per signal, 100 per document, whichever trips first. Excerpt context is ±80
characters around the match, and the whole excerpt is capped at 200 characters to satisfy
Constitution §7's limit on untrusted text in stored records. A payload that fires a pattern ten
thousand times must not become the response body.

**Ordering.** Matches sort by `start` ascending, so the report reads in document order.

**Persistence.** `matches` is stored on the artifact document alongside the existing
`signals` and `l1Score` fields, so the span report survives a page reload and is not a
one-shot property of the ingest response. The per-document cap and the 200-character excerpt
cap are what make that safe to store under Constitution §7. Artifacts are already
server-write-only in `firestore.rules`, so a client cannot edit the evidence against itself —
which matters, because a user who could rewrite `matches` could clear their own findings.

### Tests

Added to `detect.test.ts`:

- each of the eleven signals yields at least one match with correct `start`/`end`
- offsets are correct on multi-line input and `line` matches the real line number
- multiple occurrences of the same signal all appear, up to the per-signal cap
- the per-signal and per-document caps both trip and truncate
- a hidden-unicode match renders as `U+…` rather than an empty excerpt
- two consecutive `detectL1` calls on the same text return identical results — the regression
  test for global-regex `lastIndex` leakage
- `signals`, `score` and `highConfidence` are byte-identical to the pre-change output for every
  corpus payload

---

## §B — Ask-before-act, as fixed chrome

### Behaviour

Attaching a file, pasting untrusted text, or adding a URL creates the `UNTRUSTED` artifact
exactly as today — same ingest path, same Reader screening, same INV-14. It then **stops**. No
agent turn fires and no message is sent.

The composer renders a chip:

```
report.pdf   HOSTILE     [ Show me the injections ]   [ What's in it ]
```

- **Show me the injections** renders the §A span report. No model runs.
- **What's in it** runs the existing Reader path and renders the summary through `UntrustedText`.

The Web toggle behaves the same way: a pasted URL with no accompanying message is fetched,
screened and shown as a chip. It does not guess an intent, and it does not ask a model to guess
one.

Both buttons render for every attachment regardless of verdict. A `clean` verdict still gets
**Show me the injections**, which then reports that none were found — because "we looked and
found nothing" and "we did not look" must not be the same screen.

### Constraints

Button labels are string literals in TSX. Presence is not conditional on model output. This is
the security constraint above, made concrete.

### Tests

- attaching does not fire an agent turn (no `/api/agent/chat` call)
- the chip renders for `clean`, `suspicious` and `hostile`
- the span report renders with no network call to a model endpoint
- a hostile attachment whose Reader summary is requested still renders escaped through
  `UntrustedText` (INV-9 regression guard)

---

## §C — Remove "Save a link to reflect on"

Delete the input, the Save button and the helper text from the "What it reads" modal
(`src/components/SourcesPanel.tsx`).

`POST /api/ingest/link` **stays**. The chat Web toggle uses it, and removing the route would
break §B. UI deletion only, no server change.

### Tests

No new tests. Existing `/api/ingest/link` coverage must continue to pass, which is the check
that the route was not removed along with its old UI.

---

## §D — Repository scan, in the chat composer

### Entry point

The Plus button in the chat composer gains a **GitHub** action. The user pastes a repository URL.
If they typed a message alongside it, that message is shown back on the confirmation chip as
context — it is not sent to a model. The chip offers one fixed button: **Scan this repository for
prompt injections**.

### Server flow

New route: `POST /api/ingest/repo-scan`, behind `requireAuth` and per-uid rate limiting.

```
repo ref → isValidRepoRef()                     (existing, server/github.ts:36)
         → GET /repos/{owner}/{repo}            → default_branch
         → GET /git/trees/{branch}?recursive=1  → blob list
         → filter → prioritise → cap
         → GET each blob → detectL1() → matches
         → findings report
```

All requests go to `api.github.com`, the single host already allowlisted in `server/github.ts`.
No user input reaches the host component of any URL, so this is not egress-class and needs no
destination id or capability grant.

### Filtering

**Excluded before fetching:** anything over 256 KB; known-binary extensions; lockfiles
(`package-lock.json`, `yarn.lock`, `*.sum`); `node_modules/`, `vendor/`, `dist/`, `build/`.

**Priority tier, scanned first:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
`README*`, `.github/copilot-instructions.md`, `.github/workflows/*`. These are the files an agent
is built to obey, which makes a poisoned one the highest-value target in any repository. Scanning
them first means a real finding appears at the top of the report rather than below forty false
positives from source code.

**Then** the remainder of the tree, in tree order, until a cap trips.

### Caps

`MAX_FILES = 500`, `MAX_BLOB_BYTES = 256_000`, `MAX_TOTAL_BYTES = 5_000_000`,
`WALL_CLOCK_MS = 60_000`. Whichever trips first ends the scan.

### Honest coverage

The report states what was actually scanned:

> **Scanned 412 of 2,180 files.** Stopped at the 5 MB total cap. 1,768 files were not read.

Never phrased as a clean bill of health for the repository. A partial scan that reports itself as
complete is worse than no scan.

### What this flow does not do

No Reader call. No Planner call. No artifact written. No Firestore write except one perimeter log
event recording that a scan ran, against which repository, and the finding count. Repository text
never enters a model context and is never persisted.

**The report is ephemeral by design.** It lives in the response and in client state; a reload
loses it and the user rescans. This is deliberate rather than an omission: persisting findings
would mean storing excerpts of someone else's repository in this user's database, and the scan
is cheap enough to repeat. The perimeter log keeps the durable record that a scan happened and
what it found in aggregate, which is what the audit trail needs.

### Rate limits

Unauthenticated, the GitHub API allows 60 requests per hour, which cannot complete a tree walk of
any real repository. With `GITHUB_TOKEN` set it allows 5,000. Published as an honest limit in the
README rather than discovered by a user whose scan dies at file 60.

`x-ratelimit-remaining` is already read at `server/github.ts:113`. When the budget would be
exhausted mid-scan the scan stops and reports partial coverage rather than failing.

### Tests

- `isValidRepoRef` rejects non-GitHub and malformed refs (existing coverage)
- the priority tier is fetched before the remainder
- each cap independently ends the scan and is named in the coverage line
- a fixture repository with a poisoned `AGENTS.md` reports it first
- the scan makes zero calls to any Gemini endpoint, asserted by spying on the module
- no artifact document is created by a scan

---

## §E — Constitution amendment (lands first, in its own commit)

§D introduces a new data flow, so §9's checklist applies and the amendment is committed before
the code. The git history is the evidence this project offers; that ordering is the evidence.

Worked against §9:

1. **Data flows.** A repository URL the user types → our server → `api.github.com` → text held in
   memory for the duration of the request → `detectL1` → spans returned to that user. The fetched
   text is `UNTRUSTED` and is never promoted.
2. **New untrusted input?** Yes. It does *not* route through the Reader, and that is the design:
   it routes through no model at all, which is strictly stronger than quarantine.
3. **New egress path?** No. Fixed host, no user input in the host component.
4. **New secret?** No. `GITHUB_TOKEN` already exists.
5. **New Firestore paths?** None. One event in the existing perimeter log.
6. **New invariant.** Below.
7. **Corpus payload.** A repository fixture whose `AGENTS.md` carries instruction text, so the
   claim that a poisoned agent-instruction file is surfaced is tested rather than asserted.

**INV-18** — Repository scanning is read-only and model-free. Fetched repository text is never
placed in a model context, never persisted as an artifact, and never becomes grounding. The scan
reports spans; it does not summarise. A scanner that cannot be injected is one that does not
think.

---

## Risks accepted

**False positives on source code.** Whole-tree scanning was chosen over the narrower agent-facing
scope. Security repositories, test fixtures and payload corpora will fire `instruction_override`
and `offdomain_url` legitimately. Mitigated by the priority tier and by ranking `highConfidence`
signals first; not eliminated. Perimeter's own repository will report findings in
`server/corpus.ts`, and that is correct behaviour.

**Scan latency.** A 500-file scan against the GitHub API takes tens of seconds. The UI must show
a live coverage counter; a spinner with no progress will read as a hang.

**§A touches the file every verdict depends on.** Mitigated by making the change purely additive
and asserting the existing outputs are byte-identical across the whole corpus before anything
else is built.
