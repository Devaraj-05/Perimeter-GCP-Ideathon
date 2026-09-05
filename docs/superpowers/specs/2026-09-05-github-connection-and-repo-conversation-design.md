# Connect GitHub, scan a repository, talk about it

**Date:** 2026-09-05 · **Status:** approved, not yet implemented
**Scope:** Spec 1 of 2. Spec 2 covers the chat surface (decomposing `JournalEditor.tsx`, then
restyling) and is independent of this one.

**This spec becomes two implementation plans.** Plan 1 is §A + §B — the amendment and the
connection, which land together and change nothing a user sees except a new menu item. Plan 2 is
§C + §D + §E — repository content through the airlock, remediation copy, and the composer flow.
They are specified together because §C's ingest is the reason §A amends INV-18, and separating
them would hide why the invariant moved.

## Context

The repository scanner works and answers exactly one question: where are the prompt
injections. Two things are missing from it as a product.

It cannot reach private repositories, because it has no credential. And it cannot answer a
follow-up. A user who is shown *"`AGENTS.md` line 3 — instruction_override"* immediately wants
to ask "is that actually dangerous?" and "how do I fix it?", and today the scan is a dead end.

Adding the second capability requires amending **INV-18**, which currently reads *"Repository
scanning is read-only and model-free… The scan reports spans; it does not summarise."* That
invariant is one commit old and it is the feature's headline claim, so the amendment states
precisely what survives and what does not.

---

## Decisions taken before design

**INV-18 is amended, not abandoned.** Detection stays deterministic. Discussion routes through
the airlock. See §A.

**A classic OAuth App, not a GitHub App.** The `repo` scope grants read **and write** on every
private repository, and GitHub offers no read-only private alternative for OAuth Apps. The
narrower option — a GitHub App with `Contents: Read-only` and per-repository selection — was
offered and rejected in favour of reusing Amendment H's proven pattern. The write capability is
therefore mitigated in code (INV-19) and disclosed in the README rather than left implicit.

**Repository content that reaches a model is bounded.** A whole repository cannot go through
the Reader; 124 files would be 124 model calls and 124 Firestore writes per scan. See §C.

---

## §A — Amendment J (lands first, in its own commit)

Worked against §9's checklist.

**1. Data flows.** Two.

*Connection:* an operator-configured OAuth client → a consent the user grants → an access token
held by us, sealed → repository reads on demand.

*Content:* repository files → `detectL1` (unchanged, model-free) → findings; and separately, a
bounded selection of those files → `ingestUntrustedText` → `UNTRUSTED` artifacts → the Reader →
the Planner.

**2. New untrusted input?** Yes, and it is now routed through the Reader rather than around it.

**3. New egress path?** No. All requests go to `api.github.com` and `codeload.github.com`, both
already allowlisted. No user input reaches the host component of any URL.

**4. New secrets?** Two: `GITHUB_CLIENT_ID` (non-secret, an env var) and the OAuth client
secret from Secret Manager, pinned, with a scoped IAM binding. The existing
`GOOGLE_OAUTH_ENC_KEY` seals the stored token — one key, both providers, because a second
encryption key with the same lifetime and the same blast radius buys nothing.

**5. New Firestore paths?** One document: `users/{uid}/private/github`. That collection already
denies the client both read and write (Amendment H), and its rules tests already cover the
whole `private/` subtree.

**6. Revised and new invariants.**

> **INV-18 (revised)** — Repository **detection** is deterministic and model-free. The scan that
> finds, ranks and quotes injections runs no model, and `server/reposcan.ts`,
> `server/containment.ts` and `server/triage.ts` remain asserted clean of model imports.
>
> Repository **content** may additionally be discussed, and that discussion routes through the
> airlock exactly as a fetched page or an uploaded PDF does: ingested as `UNTRUSTED`, read by a
> model that holds no tools, never shown raw to the Planner. The set of files that becomes
> discussable is bounded and the bound is reported to the user.
>
> What is given up: the scan is no longer the only thing that touches a repository. What is
> kept: nothing that decides whether a file contains an injection can be argued with by that
> file.

> **INV-19** — The GitHub token is never used to modify a repository. Every GitHub URL this
> application requests is matched against an allowlist of endpoint shapes before the request is
> made. Exactly one call site uses a method other than GET: `DELETE
> /applications/{client_id}/token`, which revokes our own grant at disconnect. It touches no
> repository and its purpose is to give up access, not to use it.
>
> The `repo` scope grants write access to every private repository the user can reach. This
> application never exercises it, and a test asserts the call-site list — the allowlist and the
> single exception — rather than trusting the claim.

**7. Corpus payload.** A repository fixture whose `README.md` carries an injection addressed to
a code-review assistant, so the claim that repository content is screened *and* discussable
without becoming privileged is tested rather than asserted.

---

## §B — The connection

New file `server/githubAuth.ts`, deliberately a near-copy of `server/gmail.ts`. The shape is
proven, its failure modes are understood, and a second OAuth implementation that diverges from
the first is a second set of mistakes.

```ts
export async function beginConnect(uid: string): Promise<string>;   // authorize URL
export async function consumeState(nonce: string): Promise<string>; // → uid, single use
export async function completeConnect(uid: string, code: string): Promise<void>;
export async function isConnected(uid: string): Promise<boolean>;
export async function disconnect(uid: string): Promise<void>;
export async function githubToken(uid: string): Promise<string | null>;
```

Reuses without modification: the `oauth_states` collection and its single-use nonce (INV-17),
`seal`/`open` from `server/tokencrypto.ts` (INV-16), and the `users/{uid}/private/` rules.

**Endpoints:** authorize `https://github.com/login/oauth/authorize`, exchange
`https://github.com/login/oauth/access_token`. **Scope:** `repo`.

**One difference from Gmail worth naming.** A classic GitHub OAuth App issues a non-expiring
access token and no refresh token. There is no refresh path to build, and equally no expiry to
limit damage — so `disconnect` must revoke at GitHub via
`DELETE /applications/{client_id}/token`, not merely delete our copy. Deleting our copy while
GitHub still considers the grant live would leave the user believing they had disconnected.
This is the one place the application issues a non-GET GitHub request, and INV-19's allowlist
names it explicitly as the single exception.

**Routes** in `server/githubRoutes.ts`, mirroring `gmailRoutes.ts`: `GET /api/github/status`,
`POST /api/github/connect`, `POST /api/github/disconnect`, `GET /api/github/callback`. The
callback is unauthenticated by necessity and takes its identity from the nonce, never from the
query string (INV-17).

**`server/github.ts` gains the token.** `usableToken()` currently reads `process.env.GITHUB_TOKEN`.
It becomes `usableToken(uid?)`: a connected user's sealed token first, the deployment-wide
environment token second, anonymous third. The existing bad-credential fallback applies to
both — a user's expired token degrades to the deployment token, then to anonymous, and the
warning names which.

---

## §C — Repository content through the airlock

### What becomes discussable

Not the whole repository. The scan still reads every eligible file; the *discussable* subset is
bounded, in priority order:

1. every file with a finding at tier `live` or `active`
2. every agent-facing file (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/**`)
3. `README`
4. every file with a finding at tier `quoted`

capped at **20 artifacts per scan**. A re-scan of the same repository replaces that repository's
artifacts rather than adding to them — artifact ids are derived from `repo:<owner>/<name>` and
the file path, so a second scan overwrites the first and a repository cannot accumulate hundreds
of stale artifacts across runs. Each becomes an `UNTRUSTED` artifact via the existing
`ingestUntrustedText`, with `sourceType: 'url'`, `sourceRef: <repo>/<path>`, `sourceId:
repo:<owner>/<name>` and `allowedHosts: ['github.com', 'githubusercontent.com']`.

**The bound is reported, not hidden.** The scan card states *"20 of 124 files are available to
discuss"*, and a question about a file outside the set is answered *"that file was scanned but
not ingested"* rather than guessed at. This is the same rule as the coverage line: a partial
answer that presents itself as complete is worse than no answer.

### Cost, stated

Twenty artifacts is twenty Reader calls and twenty Firestore writes per scan, serially about
twenty seconds. Ingest runs **after** the findings are streamed, so the report appears at its
current speed and the discussable set fills in behind it with its own progress line.

### What this does not become

No RAG, no embeddings, no repository-wide index. Perimeter can discuss twenty files it read. It
cannot answer "where is authentication handled" for a repository it ingested twenty files of,
and it says so rather than inferring.

---

## §D — Remediation

Two kinds, and they must not be confused.

**Deterministic advice**, fixed copy keyed on `(signal, tier, role)`, written by us and rendered
beside the finding. Example, for `instruction_override` at tier `live` in `agent_instructions`:

> An agent reads this file as instructions. Text here that addresses an assistant, that you did
> not write, is executed rather than displayed. Remove it, and treat any contributor who can
> edit this file as able to run commands as you.

**Model answers**, for follow-ups, from the Planner with the findings and the ingested artifacts
in context. Subject to every existing rule: the Planner sees the Reader's typed observations,
never raw repository text, and any turn touching a repo artifact is tainted, so a write or an
egress still needs a click.

The distinction is visible in the UI: fixed advice renders as part of the finding, model answers
render as conversation. A user must be able to tell which sentences we stand behind and which a
model produced from attacker-influenced input.

---

## §E — The composer flow

`+ → Connect GitHub` replaces `+ → Scan a GitHub repository`.

- **Not connected:** the item opens the OAuth consent. On return the chip reads *"GitHub
  connected"* with a disconnect action.
- **Connected:** the item is a status row. Scanning is driven by pasting a repository URL into
  the composer.

**Pasting a GitHub URL** with no message shows a fixed chip — *"Scan this repository for prompt
injections"* — the same ask-before-act chrome as every other attachment, and for the same
reason: the question we put to the user is never composed by a model that has read attacker
content.

Public repositories continue to scan with no connection at all, as they do today.

---

## Testing

**Unit, no infrastructure:**
- `githubAuth.test.ts` — nonce single-use, identity from nonce not query string, sealed at rest,
  never returned to a client. Mirrors `gmail.test.ts`.
- INV-19 — a source-level assertion that every GitHub `fetch` call site uses GET, with the token
  revocation the single named exception.
- The discussable-set selection is pure: given a scan result, assert priority order and the cap.

**Emulator:** `users/{uid}/private/github` denies the owner read and write. Covered by the
existing `private/` wildcard rules test; extend the case list rather than the rule.

**Corpus:** the §A.7 payload, run by `npm run replay`.

**Regression, non-negotiable:** `npm run replay` unchanged at 20/0/20-20/11 and 5/0/5-5/4, and
the reachability suite still asserts `reposcan.ts`, `containment.ts` and `triage.ts` import no
model. INV-18's surviving half is exactly that assertion.

**End to end:** connect, scan `Devaraj-05/Perimeter-GCP-Ideathon`, confirm the verdict is
unchanged from today, then ask "why is `server/corpus.ts` only quoted?" and get an answer that
cites the finding rather than inventing one.

---

## What this cannot do

1. **The token can write, and we hold it.** INV-19 bounds it to reads in *our* code; it does not
   bound what the credential itself permits. Anyone who obtains the sealed token and the
   encryption key has write access to every private repository the user can reach. A GitHub App
   with `Contents: Read-only` would not have this property. The trade was made deliberately and
   belongs in Honest Limits.
2. **Twenty files is not a repository.** Questions outside the ingested set are refused, not
   inferred, and that will feel like a limitation because it is one.
3. **Discussion is injectable in the way summaries always were.** A poisoned file can make an
   answer wrong. It cannot make it privileged: the Reader holds no tools and the turn is tainted.
4. **Detection is unchanged.** This spec adds no ability to find injections that L1 misses.
5. **GitHub OAuth Apps have no per-repository consent.** The user grants access to everything
   they can see. The picker described in the original request does not exist outside GitHub Apps.
