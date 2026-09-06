# Perimeter Engineering Constitution — v1

**Adopted 2026-09-02.** This is the security contract for this repository. It is pasted
verbatim into Google AI Studio → Custom Instructions and referenced by the coding agent's
operating context.

It **extends** [`CUSTOM_INSTRUCTIONS.md`](CUSTOM_INSTRUCTIONS.md), which holds the challenge's
Production Directives exactly as issued. Where this document is more specific, it governs;
where it is silent, the Production Directives govern. Neither may be weakened.

Every integration edits this file **first**, in its own commit, before the integration's code is
written. The version increments. The git history is the evidence.

---

You are generating code for a production application handling private personal journals. These
directives override any conflicting default. If a request would violate one, refuse and name
the invariant it breaches.

## §1 Threat model

This application has all three ingredients of an exploitable agent: access to private user data,
exposure to attacker-controlled content, and the ability to act externally. The primary threat
is **indirect prompt injection** — instructions embedded in content the application reads on the
user's behalf, executed with the user's privileges.

Secondary threats: cross-user data access, secret disclosure, SSRF via user-supplied URLs,
stored XSS through rendered untrusted content, exfiltration via rendered resource URLs,
log-based secret leakage, and denial of service through unbounded input.

Assume every byte of external content is attacker-authored. Assume the attacker has read this
constitution.

## §2 Invariants — absolute

- **INV-1** No `UNTRUSTED`-zoned text enters a model request that carries tools.
- **INV-2** The Reader model request never includes `tools` or any tool configuration.
- **INV-3** Every data access is scoped by a `uid` from a verified Firebase ID token. Never from
  a request body, query string, header, or model output.
- **INV-4** No tool WITH A SIDE EFFECT executes without a live, unexpired capability grant
  matching `(uid, tool, resource)`. Default deny. Read-only tools over the caller's own data are
  authorised by the verified uid alone (Amendment Q).
- **INV-5** Tainted (`UNTRUSTED`-derived) data in an egress payload requires fresh one-shot user
  confirmation, regardless of standing grants.
- **INV-6** Every authorisation decision, allow or deny, writes a perimeter event **before** the
  tool executes.
- **INV-7** Client code never writes to the audit collection. Enforced in rules, not convention.
- **INV-8** Secrets come from Secret Manager at runtime, pinned by version, never logged, never
  returned to a client, never committed.
- **INV-9** Untrusted and model-derived text is rendered escaped. Never as HTML, never
  auto-linkified, and never as the source of a loaded resource.
- **INV-10** Client-facing errors are generic typed codes. No stack traces, secret names, or
  internal paths.
- **INV-11** Outbound fetches are HTTPS-only, resolve to public unicast addresses, are size- and
  time-capped, and do not auto-follow redirects.
- **INV-20** A streamed reply is preceded by its taint verdict, and a partial reply is never
  persisted. See Amendment L.
- **INV-21** A cached Reader observation is bound to a digest of the exact bytes it was derived
  from, and reusing it changes neither zone nor taint. See Amendment M.
- **INV-22** An export contains only the caller's own subtree, and never a credential. See
  Amendment N.
- **INV-23** Deletion is ordered so a partial failure leaves an account recoverable, not orphaned:
  data first, Auth record last, third-party grants revoked before either. See Amendment N.
- **INV-24** Retention deletes artifacts, never entries; scoped to expired documents only. See
  Amendment O.
- **INV-25** An embedding does not launder provenance — ranking selects untrusted candidates, it
  does not make them trusted. See Amendment P.
- **INV-26** A mailbox search term is derived only from what the user typed in their own message,
  never from an artifact, a turn, an attachment or a tool result. See Amendment R.

## §3 Secure coding standards

Validate every external input against an explicit schema at the boundary; parse, do not merely
check. Typed SDK calls only — never string-built queries. No `eval`, no `new Function`, no
dynamic `import()` of user-influenced paths. Pin dependency versions with a lockfile; **no new
dependency without a stated reason in its commit message**. Security headers: a CSP whose
`script-src` carries no `unsafe-inline` and no `unsafe-eval`, plus
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, HSTS, `object-src 'none'`,
`base-uri 'self'` and `frame-ancestors 'none'`.

Rate-limit every authenticated endpoint per uid. Cap request body size. Time out every outbound
call. Fail closed: on any error in an authorisation path, deny.

*Stated precisely because the shipped policy does carry `'unsafe-inline'` on `style-src`.*
Tailwind and React emit inline style attributes, and no build flag removes them without a nonce
pipeline this project does not have. It is the script directive that decides whether injected
markup can execute, and that one is clean. Claiming a blanket "no `unsafe-inline`" while
shipping it on `style-src` would be an overclaim a judge can check with one `curl -I`.

**There is no flag that removes the CSP.** An earlier build carried `CSP_DISABLED=1` as an
escape hatch "if a policy problem surfaces during judging". That was a supported way to switch
off one of INV-9's two layers, which is the same thing Amendment C.4 was withdrawn for — the
perimeter is not a mode, and neither is the backstop under it. It is removed. If the policy ever
breaks sign-in, that is a bug to fix in `server/headers.ts`, where four tests already assert the
policy's shape.

## §4 Data isolation

All user data lives under `users/{uid}/`. No user-owned data at the collection root. Every
server query includes the verified `uid` in its path. Firestore rules default-deny at
`/{document=**}` and open only owner reads. Client writes to security-relevant collections are
disallowed; writes are server-mediated so they pass validation and logging. Never widen a rule
to fix a bug — fix the query. Cross-user aggregation is forbidden unless explicitly scoped and
covered by a rules test.

## §5 Secret management

No secret in source, in a committed `.env`, in a Dockerfile, in a build argument, or in any
value-bearing configuration. Environment variables may hold **resource paths** to secrets only.
Fetch at runtime from Secret Manager with a **pinned version** — never `latest` — so rotation is
a deliberate deploy rather than a silent behaviour change. Cache in process memory only. Run
under a dedicated service account holding `secretAccessor` on the individual secret and nothing
broader. Redact secret values in all log output.

*Note for accuracy:* Cloud Run's `--set-secrets` does not embed anything in the container image;
it injects at instance start. The reason this project fetches through the SDK instead is that
the Production Directives demonstrate that pattern, it makes Secret Manager usage visible in the
source, and it permits version pinning. Do not claim env injection is insecure — it is not.

## §6 Model interaction rules

Two model roles with asymmetric privilege.

**The Reader is quarantined.** No tools. Response schema enforced. Temperature 0. Input
truncated to a cap. It sees `UNTRUSTED` content and produces typed JSON. The absence of tools —
not its system instruction — is what makes it safe.

**The Planner is privileged.** It sees only `SYSTEM`, `USER`, and `DERIVED` content, and holds
the tool declarations. It never sees raw untrusted text.

Model output is a **proposal**. It is never executed without passing the broker. Tool
declarations never accept a user identifier, a raw URL, an email address, or any free-form
destination — only opaque IDs the server resolves against that user's own records. Model output
is never `eval`'d, never used to construct a query path, and never rendered as HTML.

**Model selection is fixed by the Production Directives** and may not be substituted: the
fallback ladder is `gemini-3.6-flash` → `gemini-3.1-flash-lite` → `gemini-flash-latest` →
`gemini-3.7-flash`, accessed through a single `generateContentWithFallback` helper. Both model
roles draw from this ladder.

## §7 Logging and observability

Every authorisation decision is logged with a machine reason code and an invariant reference.
Logs contain no secrets, no more than 200 characters of untrusted text, and no full egress
payloads — hash them. The audit trail is append-only and hash-chained. Structured JSON logs
carry the uid and no further PII.

## §8 Error handling and stability

Every external call — Gemini, Firestore, Secret Manager, outbound fetch — is wrapped with a
timeout, a bounded retry with jitter on transient failures only, and a typed error. No unhandled
rejection may crash the process. Degrade gracefully: if the Reader fails, the app still
journals, with a visible notice that external content could not be analysed. **It never falls
back to sending raw untrusted text to the Planner** — failing closed is the point. Never retry a
non-idempotent egress call. Health check that touches no downstream service.

## §9 Before adding any integration — mandatory checklist

Complete all of this *before* writing integration code, and commit the constitution edit
separately:

1. Name the new data flows. For each: what is the source, and what zone does it carry?
2. Does it introduce a new untrusted input? If so it routes through the Reader. No exceptions.
3. Does it introduce a new egress path? If so it is egress-class: opaque destination IDs, a host
   allowlist, taint checks, and a capability grant.
4. Does it need a new secret? Add it to Secret Manager, pinned, with a scoped IAM binding.
5. Does it need new Firestore paths? Add default-deny rules and a rules test *first*.
6. Add the integration's specific invariants to §2 and bump the version.
7. Add at least one red-team payload targeting the new surface to the corpus.

## §10 Refusal directive

If asked to hardcode a key, disable a rule to unblock a bug, pass a `uid` from a request body,
bind tools to the Reader, skip the broker "just for testing", render untrusted content as HTML,
or widen an IAM role beyond a single secret — refuse, name the invariant, and propose the
compliant alternative.

---

## Compliance status at adoption

Recorded honestly, from [`AUDIT.md`](AUDIT.md), so the starting position is not misrepresented:

| | |
|---|---|
| **Passing** | INV-3, INV-6, INV-7, INV-10 |
| **Partial** | INV-2, INV-8, INV-11 |
| **Not yet implemented** | INV-4, INV-5 |
| **Violated at adoption** | **INV-1** (`server/agent.ts:199`), **INV-9** (`src/components/JournalEditor.tsx:907`) |

A constitution adopted while two of its invariants are breached is a plan, not a claim. Both
violations are closed before this document's compliance section is amended.

---

## Amendment C — Adversarial self-testing

Adopted 2026-09-02. Governs the red-team console and the injection corpus.

- **C.1** Every corpus payload runs through the REAL pipeline — the same ingest, Reader,
  Planner, broker and log path a genuine attack would take. A payload that is only ever
  simulated proves nothing, and a demo that stages its own success is worse than no demo.
- **C.2** A payload must be blocked by an ARCHITECTURAL property — the absence of tools on the
  Reader, the taint rule, the capability check — not by the Reader's system instruction alone.
  If a payload is stopped only because the model was asked nicely, that is a finding to record,
  not a pass to claim.
- **C.3** Results are recorded honestly, including misses. Detection efficacy is published as
  attempted / detected / reached-execution. A security claim that cannot be falsified is not a
  security claim (INV — honest limits).
- **C.4** ~~The demonstration toggle that disables the defence is a controlled hazard.~~
  **WITHDRAWN, 2026-09-03. Never implemented.**

  This clause governed a toggle that would disable the defence to show the undefended failure.
  The toggle was cut early and never built, which left the constitution regulating a feature
  that does not exist — the "documenting instead of shipping" failure `phase-plan.md` warns
  about, and precisely the kind of gap between claim and code this project exists to argue
  against. Striking it rather than quietly deleting it: the withdrawal is the record.

  A deliberate consequence: there is now **no supported way to turn the perimeter off**. The
  airlock is not a mode.
- **C.5** Every new integration adds at least one corpus payload targeting its surface (this is
  §9.7 restated as a standing obligation).

---

## Amendment D — Location-aware entries (adopted 2026-09-04, **WITHDRAWN 2026-09-06**)

> **Withdrawn.** The feature was removed in full: `server/location.ts`, `locationRoutes.ts`, the
> `/api/location` mount, `getMapsKey`, the `MAPS_KEY_SECRET` binding, the `location` field on an
> entry, and the composer control.
>
> **Why.** Nothing ever read the value back. No tool consumed it, no prompt included it, no view
> filtered on it, no search used it. It cost an API key, a scoped IAM binding, an outbound host, an
> invariant and a rate limiter, to store a string that was written and never used. A threat surface
> that buys nothing is not a neutral cost — it is the kind of thing this document exists to refuse,
> and it survived four amendments because nobody asked what consumed it.
>
> **What is kept.** The reasoning below stands as a record: the checklist was worked correctly and
> the design was sound. It was the wrong feature, competently built. The amendment is preserved
> rather than deleted because the history is the evidence that §9 was followed, and deleting an
> entry from that history to look tidier would be the same instinct as deleting a log line.
>
> **INV-12 is retired**, not weakened — it governed a key this deployment no longer holds.
> The red-team payload that rode in on the location field (`P13`) was not deleted either: it was
> **repointed at filenames**, which carry the identical property the payload was written to probe —
> short, metadata-shaped, attacker-chosen, displayed next to the thing they name.

Adopted **before** any location code was written, per §9. A journal entry may carry the place it
was written. This works §9's checklist in order.

**1. Data flows.** Browser geolocation (or a place name the user types) → our server → the Google
Geocoding API → a place name stored on that user's own entry document. Coordinates are `USER`
zone; the geocoding response is `DERIVED`.

**2. New untrusted input?** Yes, in the weak sense: the geocoding response is text from outside
this system. It is not attacker-controlled in any realistic scenario, but it is not ours either,
so it is treated as external-origin data — rendered through the INV-9 renderer like every other
string this application did not author. The cost of being consistent here is one import.

**3. New egress path?** No. The request goes to a fixed Google host that no user input can
change, so this is not egress-class and needs no capability grant or destination id. If a future
change ever lets a user influence that host, this clause is void and §9.3 applies in full.

**4. New secret?** Yes. `MAPS_API_KEY`, from Secret Manager, pinned by version, with a scoped IAM
binding on that one secret. It is resolved by the same code path as the Gemini key rather than a
second copy of it.

**5. New Firestore paths?** No new collection. New optional fields on `users/{uid}/entries/{id}`,
which is already owner-scoped and covered by existing rules and tests.

**6. New invariant.**

- **INV-13** A role is read only from a verified Firebase custom claim. Never from a Firestore
  document, a request body, a header, a query string, or model output. There is no HTTP route
  that grants a role — an endpoint that mints administrators is the thing being defended against,
  so the grant is a local script run with Admin credentials.

**Administrative scope is deliberately narrow.** An admin sees aggregate counters — how many
attacks were fired, how many were blocked, the distribution by class. An admin does **not** see
another user's entries, sources, destinations, or perimeter log, and no code path exists to. INV-3
stands unchanged and unweakened: there is still no cross-user read in this application. A security
dashboard that reads private journals would contradict the product it is reporting on.

**7. Corpus payload.** A document instructing the assistant to grant itself administrative
privileges is added to the corpus.

---

## Amendment F — Attaching untrusted content from the chat (adopted 2026-09-04)

Adopted **before** any attachment code was written, per §9. Until now untrusted content entered
only through a separate panel. It may now be attached directly in the chat composer, which is
where a user actually is when they have something suspicious in hand.

**1. Data flows.** Text a user pastes, or a URL they add, from the composer → the existing ingest
path → an `UNTRUSTED` segment and an artifact. Identical to a fetched page in every respect.

**2. New untrusted input?** Yes, and it is the point. It routes through the Reader like everything
else. There is no shortcut for content that arrived by paste rather than by fetch — a note is not
more trustworthy because a human typed it in, since the whole scenario is a human pasting
something an attacker wrote.

**3. New egress path?** No.

**4. New secret?** No.

**5. New Firestore paths?** None. Reuses `users/{uid}/artifacts` and its existing rules and tests.

**6. New invariant.**

- **INV-14** Content attached in the chat is `UNTRUSTED` from the moment of attachment. Nothing
  the user says afterwards, and nothing the model infers, can re-classify it. There is no "trust
  this one" affordance, because a user who could grant trust to a document is a user an attacker
  can talk into granting it.

**A note on why attachments do not weaken the airlock.** Attaching content sets grounding, and
grounding already switches the conversation onto the agent path where the Reader holds no tools
and `assertNoUntrusted` guards the Planner. This amendment adds an entry point, not a code path.
Any change that made attachments bypass the Reader would breach INV-1 and is forbidden.

**7. Corpus payload.** A pasted note impersonating an earlier conversation turn is added to the
corpus.

---

## Amendment G — Files: PDFs and images (adopted 2026-09-04)

Adopted **before** any upload code was written, per §9.

**1. Data flows.** Uploaded bytes → a transcription call to Gemini → `UNTRUSTED` text → the
existing `ingestUntrustedText` path. The bytes never reach the Planner, never reach Firestore, and
never leave the request that carried them.

**2. New untrusted input?** Two, and they are the most dangerous yet. **An instruction rendered as
pixels is invisible to every text filter in this system.** L1 pattern matching sees nothing. L2
classification sees nothing. Only the absence of tools on the model that reads it stands between
an image and an action — which is the argument this project exists to make, in its purest form.

**3. New egress path?** No.

**4. New secret?** No.

**5. New Firestore paths?** None. Reuses `users/{uid}/artifacts`.

**6. New invariant.**

- **INV-15** Uploaded bytes are never persisted. Only the text extracted from a file becomes an
  artifact; the bytes are discarded within the request that carried them. There is no blob store,
  no storage rule to get wrong, and nothing binary to leak. The real type is determined by
  inspecting the file's leading bytes — a declared MIME type is attacker-controlled input and must
  never select the parser.

**On adding no dependency.** §3 forbids a new dependency without a stated reason. None is needed
here: Gemini accepts PDF and image bytes directly as `inlineData`, and
`generateContentWithFallback` already carries the mandated model ladder and sets no `tools` key,
so transcription is a Reader-class call by construction. Adding a PDF parser would introduce a
dependency *and* a second extraction path with no security benefit.

**On the transcription call being injectable.** It is, and that is fine. A poisoned document can
make the transcription wrong. It cannot make it privileged: the transcriber holds no tools, and
its output is stored as `UNTRUSTED`, screened by L1 and L2, and fenced before any Reader sees it.
A compromised transcription produces poisoned text in a quarantine, which is precisely where
poisoned text is supposed to end up.

**7. Corpus payloads.** A PDF carrying hidden instruction text and an image carrying visible
instruction text are added to the corpus.

---

## Amendment H — Gmail, third-party OAuth (adopted 2026-09-04)

Adopted **before** any OAuth code was written, per §9. This is the most sensitive integration in
the application: it holds a credential that grants read access to a user's mail.

**1. Data flows.** An operator-configured OAuth client → a consent the user grants → a refresh
token held by us → message bodies fetched on demand → `UNTRUSTED` text through the existing
`ingestUntrustedText` path. Subject, sender and body are all attacker-controlled: anyone can send
an email, which makes an inbox the single most reliable way to put chosen text in front of
someone's assistant.

**2. New untrusted input?** Yes, and it is the canonical one. It routes through the Reader.

**3. New egress path?** No. Gmail is read-only (`gmail.readonly`) and we never send.

**4. New secrets?** Two: the OAuth client secret, and a 32-byte key used to encrypt stored refresh
tokens. Both from Secret Manager, pinned, with scoped IAM.

**5. New Firestore paths?** `users/{uid}/private/{docId}`, which denies **read and write to the
client**. Every other collection in this application permits an owner read; this one does not,
because unlike a journal entry there is no legitimate reason for a browser to ever hold this
value, and "the owner can read it" is how a token ends up in a debugger, a screenshot, or a
support ticket. Rules tests are written first.

**6. New invariants.**

- **INV-16** A third-party OAuth token is encrypted at rest with a key from Secret Manager, is
  never returned to any client, never logged, and never enters a model context. Its document is
  unreadable by the client under any circumstances.
- **INV-17** The OAuth callback establishes identity from a server-issued, single-use `state`
  nonce bound to a uid, never from a uid supplied in the request. The callback is reached by a
  browser redirect and carries no bearer token; trusting any identity claim in that request would
  let anyone attach their inbox to someone else's account.

**On running unverified.** `gmail.readonly` is a Google *restricted* scope. Production
verification requires a security assessment and weeks of review, so this ships with the consent
screen in **testing** mode: it works immediately for explicitly listed test users and shows an
unverified-app warning. That limitation is stated plainly in the README rather than hidden — a
submission that quietly implies Google has reviewed it would be exactly the kind of overclaim this
project exists to argue against.

**7. Corpus payload.** An email whose signature block carries instructions is added to the corpus.

---

## Amendment I — Repository scanning (adopted 2026-09-05)

Adopted **before** any scanning code was written, per §9. A user may point Perimeter at a
public GitHub repository and ask one question: **is there a prompt injection in it?**

This is the first integration that reads untrusted content and deliberately does **not** route
it through the Reader. That is not a weakening. It is the stronger position: the content goes
through no model at all.

**1. Data flows.** A repository reference the user types → our server → `api.github.com` → file
text held in memory for the life of one request → `detectL1` → match spans returned to that
user. The fetched text is `UNTRUSTED` and is never promoted, never stored, and never shown to a
model.

**2. New untrusted input?** Yes, and a large one — an entire repository, most of it written by
strangers. §9.2 says untrusted input routes through the Reader "no exceptions". This amendment
is not an exception to that rule; it is a case the rule did not anticipate. The Reader exists to
let a model read hostile text safely by removing its tools. Here no model reads the text at all,
so there is nothing to quarantine. A scanner that cannot be injected is one that does not think.

The consequence is deliberate and is the feature’s boundary: Perimeter can tell you a
repository contains an injection and quote it. It cannot tell you what the repository does.
Asking it to summarise a repository would require a model, and that is a different feature with
a different amendment.

**3. New egress path?** No. Every request goes to `api.github.com`, the single host already
allowlisted in `server/github.ts`. No user input reaches the host component of any URL — the
owner and name are validated by `isValidRepoRef` and URL-encoded into a path. Not egress-class,
so no destination id and no capability grant.

**4. New secret?** No. `GITHUB_TOKEN` already exists. Without it the GitHub API allows 60
requests an hour, which cannot complete a tree walk of any real repository; with it, 5,000. That
limit is published in the README rather than discovered by a user whose scan dies at file 60.

**5. New Firestore paths?** None. A scan writes one event to the existing perimeter log and
nothing else. No artifact, no segment, no stored excerpt.

**6. New invariant.**

- **INV-18** Repository scanning is read-only and model-free. Fetched repository text is never
  placed in a model context, never persisted as an artifact, and never becomes grounding. The
  scan reports spans; it does not summarise. Coverage is reported honestly — a scan stopped by a
  cap says which cap and how many files it did not read, because a partial scan that reports
  itself as complete is worse than no scan.

**A note on false positives, recorded because it was a deliberate choice.** The narrower option
was to scan only the surfaces an agent is built to obey — `AGENTS.md`, `CLAUDE.md`,
`.cursorrules`, `README`, `.github/**`, issues and pull requests. Whole-tree scanning was chosen
instead, with the cost understood: source code that legitimately mentions "ignore previous
instructions" will fire patterns, and security repositories will fire many. This repository will
report findings in `server/corpus.ts`, and that is correct behaviour, not a bug. The mitigation
is ordering and labelling, never suppression. Every match is reported; each is classified by the
file's role and the match's syntactic position, so a payload in a fixture's template literal
reads as *quoted* while the same text unquoted in an `AGENTS.md` reads as *live*. A poisoned
agent-instruction file is what the scan exists to find, and it is never buried under a test
fixture.

That classification is deterministic — file paths and grammar, no model — so INV-18 is unchanged
by it. It also adds no detection power: it re-ranks what the patterns already found, and a fence
is a rendering instruction rather than a barrier.

**7. Corpus payload.** A repository fixture whose `AGENTS.md` carries instruction text, so the
claim that a poisoned agent-instruction file surfaces first is tested rather than asserted.

---

## Amendment J — GitHub connection and repository conversation (adopted 2026-09-05)

Adopted **before** any connection code was written, per §9. Two things change: a user may
connect their GitHub account, and repository content becomes discussable.

**1. Data flows.** Two. *Connection:* an operator-configured OAuth client → a consent the user
grants → an access token held by us, sealed → repository reads on demand. *Content:* repository
files → `detectL1` (unchanged, model-free) → findings; and separately, a bounded selection of
those files → `ingestUntrustedText` → `UNTRUSTED` artifacts → the Reader → the Planner.

**2. New untrusted input?** Yes. It is now routed *through* the Reader rather than around it.

**3. New egress path?** No. Every request goes to `api.github.com`, `codeload.github.com` or
`github.com`, and no user input reaches the host component of any URL.

**4. New secrets?** One: the GitHub OAuth client secret, from Secret Manager, pinned, with a
scoped IAM binding. `GITHUB_CLIENT_ID` and `GITHUB_OAUTH_REDIRECT` are not secrets and are
plain environment variables. The existing `GOOGLE_OAUTH_ENC_KEY` seals the stored token — one
key for both providers, because a second key with the same lifetime and the same blast radius
buys nothing.

**5. New Firestore paths?** One document: `users/{uid}/private/github`. That collection already
denies the client read and write, and its rules tests already cover the whole `private/` subtree.

**6. Revised and new invariants.**

- **INV-18 (revised)** Repository **detection** is deterministic and model-free. The scan that
  finds, ranks and quotes injections runs no model, and `server/reposcan.ts`,
  `server/containment.ts` and `server/triage.ts` remain asserted clean of model imports.

  Repository **content** may additionally be discussed, and that discussion routes through the
  airlock exactly as a fetched page or an uploaded PDF does: ingested as `UNTRUSTED`, read by a
  model that holds no tools, never shown raw to the Planner. The set of files that becomes
  discussable is bounded, and the bound is reported to the user.

  *What is given up:* the scan is no longer the only thing in this application that touches a
  repository. *What is kept:* nothing that decides whether a file contains an injection can be
  argued with by that file.

- **INV-19** The GitHub token is never used to modify a repository. Every GitHub URL this
  application requests is matched against an allowlist of endpoint shapes before the request is
  made. Exactly one call site uses a method other than `GET`: `DELETE
  /applications/{client_id}/token`, which revokes our own grant at disconnect. It touches no
  repository, and its purpose is to give up access rather than to use it.

**A standing obligation on the INV-18 revision.** The connection ships first; the ingest that
justifies the revision ships in the commit after it. Until that lands, this clause regulates a
capability the application does not have — which is the failure C.4 was withdrawn for. The
revision is therefore conditional: **if the ingest is not built, INV-18 reverts to its original
wording and this paragraph records why**, in the manner of C.4 rather than by quiet deletion.
The scan being model-free is not a claim to give up speculatively.

**On the scope, recorded rather than argued away.** A classic OAuth App's `repo` scope grants
read **and write** on every private repository the user can reach, and GitHub offers no
read-only private alternative for OAuth Apps. The narrower option — a GitHub App with
`Contents: Read-only` and per-repository selection — was considered and rejected in favour of
reusing Amendment H's proven pattern. INV-19 bounds what *this code* does with the credential.
It does not bound what the credential permits: anyone holding the sealed token and the
encryption key has write access to those repositories. That is stated in the README's Honest
Limits, next to the unverified Gmail scope.

**7. Corpus payload.** A repository fixture whose `README.md` carries an injection addressed to
a code-review assistant, added in the plan that implements the ingest.

---

## Amendment L — Streaming the reply (adopted 2026-09-05)

Adopted **before** the streaming code was written, per §9. The chat reply may reach the browser
incrementally rather than in one response.

**1. Data flows.** No new source and no new sink. The same Planner output reaches the same
renderer; only the delivery changes, from one JSON body to a sequence of NDJSON records over the
same authenticated POST. NDJSON rather than SSE for the reason established by Amendment I's scan
progress: `EventSource` cannot set an `Authorization` header, and INV-3 requires a verified token
on every request.

**2. New untrusted input?** No. Model output was already model-derived text under INV-9 and is
still rendered by the same component.

**3. New egress path?** No.

**4. New secret?** No.

**5. New Firestore paths?** No. The turn is written once, complete, exactly as before — a partial
reply is never persisted.

**6. New invariant.**

> **INV-20** — A streamed reply is preceded by its taint verdict. `turnTaint` is computed from
> the assembled Planner context before generation begins, so it is sent as the first record of
> the stream, and no token of model text is written to the response before it. Until the stream
> completes, the turn is rendered as provisional and is not persisted.
>
> This is **stronger** than the atomic delivery it replaces. Previously the verdict and the text
> arrived together and the user read both at once; now the warning is on screen before the first
> attacker-influenceable character is painted.

**On the fallback ladder (§6), which streaming complicates.** Once a token has been written to
the response it cannot be withdrawn, so a mid-stream failure cannot fall through to the next
model without showing the user two different answers stitched together. The ladder therefore
resolves **before** the first token is emitted: an attempt is committed only once its first chunk
arrives, and a failure before that point falls to the next model normally. A failure after it
ends the turn with an error record rather than silently switching models. The ladder itself is
unchanged — §6 fixes those four identifiers and this amendment does not touch them.

**On tool calls.** The broker and executor still see the complete response. Text deltas are
forwarded for display as they arrive; function calls are accumulated and processed only once
generation has finished, so INV-4 and INV-6 are untouched — no tool is proposed, authorised or
executed on a partial response.

**On abandonment.** A client that disconnects mid-stream aborts generation. Nothing is persisted,
which is the same outcome as a failed turn today.

**7. Corpus payload.** None. This changes transport, not what any model reads or what any tool
does, and a payload exercising neither would be theatre. The existing corpus runs unchanged
through the non-streaming path, which remains the tested contract for the red-team console.

---

## Amendment M — Caching what the Reader saw (adopted 2026-09-05)

Adopted **before** the cache was written, per §9. A Reader observation may be stored on the
artifact it describes and reused on later turns.

**Why.** The airlock reads every untrusted artifact on every turn. Amendment L's concurrency
divided that cost; it did not remove it. A user with eighteen connected sources pays eighteen
model calls to ask a second question about the same eighteen documents, and the answer cannot
differ, because an artifact's text does not change after ingest.

**1. Data flows.** No new source and no new sink. The Reader's typed output already travelled
from the Reader to the Planner; it now also travels to Firestore and back. It is the same value,
in the same zone, read by the same component.

**2. New untrusted input?** No — and this is the clause that matters. A cached observation is
Reader output, which is `UNTRUSTED`-derived, and reading it back does not make it anything else.

**3. New egress path?** No.

**4. New secret?** No.

**5. New Firestore paths?** No new path. Two new **fields** on `users/{uid}/artifacts/{id}`,
which already denies the client both read of other users' data and *all* writes
(`allow write: if false`). No rules change, so none is smuggled in under a performance
improvement.

**6. New invariant.**

> **INV-21** — A cached Reader observation is bound to the exact bytes it was derived from. The
> cache key is a digest of the precise string the Reader was given, so an artifact whose text
> differs in any way cannot be served an observation of different text.
>
> Reuse changes nothing else. A cached observation enters the turn in the same zone, with the
> same taint, and through the same code path as a freshly computed one. It never becomes
> first-party, never suppresses a taint check, and is never treated as evidence that a document
> was screened *this* turn — it is evidence that these exact bytes were screened, which is the
> same claim.

**The risk this invariant exists to close.** This project has already shipped one taint-laundering
defect: `createdBy: 'agent'` was written to entries and never read back, so an agent-authored note
returned on a later turn as untainted first-party text. A stored Reader observation has exactly
that shape — a value computed in one turn, trusted in the next — and would be a second instance
of the same bug if the zone or the taint were reconstructed from the cache rather than from the
artifact. They are not: only `output` is cached. Zone and taint are derived, every turn, from the
artifact's own `trust` field as they were before.

**On the instruction-attempt log.** A `reader` perimeter event is written when an observation
reports an instruction attempt. That event says an attempt exists in a document the user has in
context, which remains true on a cache hit, so it is still written — the log records what is in
the conversation, not how many times a model was called. Counting model calls is a metrics
question and this is not the metrics system.

**7. Corpus payload.** None. This changes when a value is computed, not what any model reads or
what any tool does. The existing corpus runs unchanged through the same Reader; a payload that
exercised only the cache would be testing Firestore.

---

## Amendment N — Getting your data out, and getting it deleted (adopted 2026-09-06)

Adopted **before** the export and deletion code was written, per §9. A user may download everything
this application holds about them, and may delete their account.

**Why it is an amendment and not a chore.** This application ingests people's email, their web
reading, their repositories and their private journal. Holding that without a way out is a
position, and it is not one this document would defend if it were written down. It was not written
down, which is how it survived.

**1. Data flows.** Two, both entirely within one user's own subtree.

*Export:* `users/{uid}/**` → a JSON file returned to the authenticated owner of that uid.
*Deletion:* `users/{uid}/**` → removed, then the Firebase Auth user record → removed.

**2. New untrusted input?** No. Export reads what is already stored; nothing new enters.

**3. New egress path?** No, and the distinction matters. Egress in this system means *data leaving
to a destination the model can name*. An export is the owner receiving their own data over their
own authenticated session. No tool can trigger it: the Planner's tool registry has no export and no
delete, so an instruction hidden in a document cannot reach either route. That is a property of the
registry, not of prompt wording, and a test asserts it.

**4. New secrets?** No.

**5. New Firestore paths?** None. Existing paths, recursively.

**6. New invariants.**

> **INV-22** — An export contains only the caller's own subtree, and never a credential. The
> `users/{uid}/private/` collection — sealed Gmail and GitHub tokens — is **excluded from every
> export**, including the owner's own. INV-16 says the token never leaves the server, and "except
> to its owner" is not a safe exception: an export is a file, files get stored, forwarded and
> synced, and the token inside is still live at Google or GitHub. The user is told the connection
> exists and is not handed the key to it.

> **INV-23** — Deletion is ordered so that a partial failure leaves the account **recoverable, not
> orphaned**. Firestore data is deleted first and the Auth user last. If deletion fails halfway,
> the user can still sign in and retry; deleting the Auth record first would leave data that
> nobody can authenticate to reach, and therefore nobody can ever delete. Third-party grants are
> revoked at the provider before local state goes, because a token we have forgotten is still a
> token that works.

**On the audit log.** The hash-chained perimeter log is included in an export, because it is the
user's evidence of what this system did on their behalf. Its tamper-evidence does **not** survive
the export: a chain verifies against the collection it lives in, and a JSON copy of it proves
nothing on its own. The export says so in the file rather than letting a reader assume otherwise.

**7. Corpus payload.** Yes — a document instructing the assistant to export the user's data to an
address, and a second instructing it to delete the journal. Both must fail for the same structural
reason rather than a refusal: there is no tool to call.

---

## Amendment O — Retention (adopted 2026-09-06)

Adopted **before** the retention code was written, per §9. Ingested external content ages out;
the user's own journal does not.

**Why the asymmetry.** An entry is something the user wrote and may want in ten years — deleting
it on a timer would be a betrayal, not a feature. An artifact is the opposite: a copy of an email,
a web page, a scanned repository, kept only so a recent conversation could ground on it. Holding
those forever is the liability Settings admitted to ("no retention limit yet"); it is also the
larger share of what this system stores about a person's untrusted world. So artifacts expire and
entries are kept, and the privacy statement says exactly that rather than a comfortable average.

**1. Data flows.** No new inbound flow. A scheduled job, authenticated as the existing scheduler
service account (Amendment C's `requireScheduler`), deletes artifacts and their segments whose
`expiresAt` has passed, for every user. Nothing new is read into a model.

**2. New untrusted input?** No.

**3. New egress path?** No.

**4. New secret?** No — reuses the scheduler's OIDC identity.

**5. New Firestore paths?** No new collection. One field, `expiresAt`, on
`users/{uid}/artifacts/{id}`, stamped at ingest.

**6. New invariant.**

> **INV-24** — Retention deletes artifacts, never entries. The sweep is scoped to the `artifacts`
> and `segments` collections and to documents whose `expiresAt` is in the past; it has no branch
> that can touch `entries`. A user's own writing is removed only by that user, through account
> deletion or a per-entry delete — never by a timer. The window is a deployment setting
> (`ARTIFACT_RETENTION_DAYS`); when unset, nothing expires and the privacy statement says so.

**7. Corpus payload.** None. Retention changes when data is removed, not what any model reads or
what any tool does.

---

## Amendment P — Semantic retrieval, through the airlock (adopted 2026-09-06)

Adopted **before** the retrieval code was written, per §9. `search_artifacts` may rank by meaning
rather than by substring.

**Why it needs an amendment at all.** Retrieval is the seam where a security model most often
quietly fails: "it is just search" is how untrusted content ends up in a privileged context
without anyone deciding it should. This amendment states the boundary so the feature cannot drift
across it later.

**1. Data flows.** At ingest, an embedding of the artifact text is computed by the Gemini
embedding endpoint and stored on the artifact as an array of floats. At search time, the query is
embedded and ranked against those vectors by cosine similarity, in process. The ranked result is
the same shape `search_artifacts` already returns.

**2. New untrusted input?** No new SOURCE, and this is the clause that matters. An embedding is
DERIVED from untrusted text, and it stays untrusted — but it is a vector of numbers, not a span of
text, so it carries no instruction a model could follow. It is never rendered, never placed in a
prompt, and never compared to anything but another embedding. The artifact it points at remains
untrusted and, if its content ever reaches a model, does so through the Reader exactly as an
attached artifact does today.

**3. New egress path?** Yes, and it is a fixed Google endpoint no user input can influence — the
embedding API on `generativelanguage.googleapis.com`, the same host the model calls already use.
Not egress-class, by the same reasoning as the model calls themselves.

**4. New secret?** No — the existing Gemini key.

**5. New Firestore paths?** No new collection. One field, `embedding`, on an artifact.

**6. New invariant.**

> **INV-25** — An embedding does not launder provenance. Computing, storing or matching an
> embedding of untrusted text never changes the zone or the taint of the artifact it was derived
> from. Retrieval selects which untrusted artifacts are candidates; it does not make any of them
> trusted, and a turn that grounds on a retrieved artifact is tainted exactly as one that grounds
> on an attached artifact is. Ranking is not a trust decision.

**On what this does and does not buy.** It replaces a substring match, which found nothing unless
the user typed the exact word, with a ranking that finds related writing. It does not add a
retrieval-augmented generation loop: a tool result is shown to the user, not fed back to a model,
so this surfaces better matches rather than synthesising over them. That limit is real and is
recorded here rather than implied by the word "semantic".

**7. Corpus payload.** A document whose text is engineered to rank highly for an innocuous query —
so the claim that a well-ranked artifact is still untrusted, and still routes through the Reader,
is tested rather than asserted.

---

## Amendment Q — Reads of your own data need no grant (adopted 2026-09-06)

Adopted **before** the change, per §9. A read-only tool that operates solely on the caller's own
data is authorised by the verified uid alone and requires no capability grant.

**Why.** INV-4 was written to apply to every tool uniformly, and the only path that mints a grant
is a manual action in the Permissions panel. Nothing ever grants a read, so `search_artifacts` — a
search of the user's own artifacts, scoped server-side by their uid — was refused on every turn,
and any question that made the Planner reach for it came back empty. A tool the product depends on
was unusable by construction.

A grant on top of uid-scoping protects nothing for an own-data read. There is no cross-user path
(INV-3 binds every read to the verified token) and no egress (the result never leaves the user's
own session). The grant machinery exists for the two things that actually carry risk: writing
(`create_note`) and sending data outward (`send_digest`). Requiring it for a read was ceremony,
and ceremony that breaks the feature.

**Revised invariant.**

> **INV-4 (revised)** — No tool with a side effect executes without a live, unexpired capability
> grant matching `(uid, tool, resource)`. Default deny. **Read-only tools** (`sideEffect: 'read'`),
> which by construction touch only the caller's own data scoped by the uid from their verified
> token, are authorised by that uid and need no grant. The distinction is the tool's declared
> `sideEffect`, checked against the registry — not anything the model says. A tool that writes or
> sends remains default-deny, exactly as before.

**What does not change.** `send_digest` (egress) and `create_note` (write) still require a grant
and, when the turn is tainted, still require fresh confirmation (INV-5). The taint rules, the
one-shot claim, and the append-only decision log are untouched. This narrows INV-4 to the tools it
was always meant to govern; it does not loosen any of them.

**Corpus.** The existing tool-result-poisoning payload (P23) already exercises the read channel and
still blocks — a read runs, but its result reaches the user, never a tool-holding model, so a
poisoned artifact title cannot escalate. No new payload is needed; the change removed a grant
requirement, it added no new surface.

---

## Amendment R — The composer echoes, and the mailbox answers the question (adopted 2026-09-06)

Adopted **before** the change. Three defects shared one shape: the user was made to wait, without
evidence, for work that was slower than it needed to be and answered a question they had not asked.

### R.1 Optimistic echo — Directive 6 restated, not weakened

Directive 6 says *"never clear the user's input buffer before a confirmed successful write."* It
was implemented as **retention**: the text stayed in the composer for the whole turn and was
cleared only after the Firestore write resolved. That satisfied the letter and broke the intent.
With a mailbox fetch ahead of the model call, the user's own message did not appear in the
transcript for thirty seconds — they saw their text sitting in the box, a spinner, and no evidence
the send had happened at all. The one thing a chat interface must do instantly, it did last.

The guarantee Directive 6 exists to give is **the user never loses what they typed**. That is now
met by **restoration** instead of retention:

> **The user's message is painted into the transcript and the composer cleared in the same tick as
> the submit, before any network call. The submitted text is held in memory for the life of the
> turn. On any failure — send, abort, or preparation — it is restored to the composer verbatim and
> the message is marked as not delivered.**

Restoration is strictly stronger than retention. Retention protected the text only while the turn
ran; a user who typed a second message during a slow turn overwrote the first. Held text cannot be
overwritten by anything but a successful turn.

**What does not change.** A save failure still never clears, still never claims the message was not
sent, and still reports the stage that actually failed (`send` vs `save`). INV-20 is untouched: the
taint verdict still precedes the first token.

### R.2 A failed turn does not un-say what the user said

On a send failure the transcript was rolled back to `priorTurns`, deleting the user's own message
and any deterministic findings already shown. The user watched their question and several security
messages appear and then vanish, which reads as data loss and destroys the evidence the product
exists to show. A failed turn now **keeps** the user's message in place and marks it undelivered.
Only the model's reply is absent, because only the model's reply failed.

### R.3 The mailbox answers the question that was asked

`fetchRecent` pulled the ten most recent messages regardless of what was asked, so *"is there any
mail about X"* was answered by summarising four unrelated emails that happened to be newest. The
model was given the wrong documents and faithfully described them.

A mailbox read now carries a **search term derived from the user's own message** — Gmail's `q`
parameter — and a date bound when the message says *today* or *this week*.

> **INV-26** A mailbox search term is derived only from what the user typed in their own message,
> never from an artifact, a turn, an attachment or a tool result.

This is the same rule already binding on URLs (`extractUrls`) and repository names
(`findRepoReference`), and for the same reason: a search term taken from untrusted content is an
attacker choosing which of the user's emails our server reads and loads into the context. The term
is a Gmail query string, not a prompt — it is URL-encoded into a query parameter and never
concatenated into an instruction. Every message returned is still UNTRUSTED and still enters
through the Reader unchanged.

**Zone note (§9.1–9.2).** No new data flow: the source is still Gmail, the zone is still UNTRUSTED,
and the path is still `ingestUntrustedText` → Reader. What changes is *which* messages are
selected, and the selector is trusted user input.

### R.4 Latency is a security property

`/api/gmail/ingest` ingested messages one at a time, and each ingest awaited an L2 classifier call
and then an embedding call in series — twenty sequential model round trips for ten messages. It
routinely exceeded the client's 30s ceiling, and the user was shown *"That took too long and was
stopped"* about work the server was still doing. A timeout that fires on the happy path is not a
safety net; it trains the user to distrust a working system, and it is indistinguishable from the
failure it was meant to report.

Three changes, none of which touch what is screened:

1. Messages are fetched and ingested **concurrently, bounded** by the same `mapPool` the Reader
   already uses. Concurrency is capped so a large mailbox cannot convert a slow turn into a
   rate-limited one.
2. Within one ingest, the L2 classifier and the embedding run **concurrently** rather than in
   series. Neither depends on the other's result.
3. `/api/gmail/` joins the slow-path timeout list, so the client's ceiling sits above the server's
   own budget rather than below it.

**L1 and L2 both still run on every message, and the verdict is still fused from both.** Nothing is
skipped, sampled, or deferred. This amendment makes the same work take less wall-clock time; it
does not make less of it happen.

### R.5 Disclosed once, not six times

The Reader reports per observation. A turn that read one repository and two attachments produced
six Perimeter messages — four of them naming the same repository — each repeating the same two
paragraphs of explanation, with the answer the user had asked for pushed off the bottom of the
screen. The product's headline claim is that it *shows* you every attempt; six identical blocks is
how that gets scrolled past.

Reader findings for a turn are now **one message**, listing each flagged excerpt attributed to the
document it came from, under one headline and one closing line.

**What is not lost.** Every distinct excerpt is still quoted verbatim, still attributed, and still
shown in the conversation rather than only written to the perimeter log. The only thing removed is
an exact repeat of the same excerpt from the same source; the same sentence found in two different
documents is two findings and both are kept, because *which* document said it is the part the user
needs. Grouping is not summarising — no model composes this text, and none of it is elided.

### R.6 An alert is about something, or it is noise

Two page-level banners are removed.

*"Untrusted content was screened before the assistant read it"* appeared after every turn that
touched anything external — which is most of them — so it carried no information about the turn in
front of the user, and it sat permanently between the conversation and the composer. Taint is still
stated where it is about something: the amber line above the reply while it streams (INV-20), and
the finding messages that quote what was actually found.

*"Action Alert"* was raised for any failure without a stage, over the whole conversation, with a
**Retry Save** button that would have saved nothing. A failed or stopped send is a fact about one
message: it is now said under that message — "Not delivered — <reason>. Your text is back in the
box below" — and the red banner is reserved for the one failure where something is genuinely at
risk, a reply that arrived and could not be written.

This removes alerts, not disclosure. No refusal, no finding, and no taint verdict is hidden by it;
what goes is chrome that fired regardless of what happened.
