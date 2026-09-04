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
- **INV-4** No tool executes without a live, unexpired capability grant matching
  `(uid, tool, resource)`. Default deny.
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

## §3 Secure coding standards

Validate every external input against an explicit schema at the boundary; parse, do not merely
check. Typed SDK calls only — never string-built queries. No `eval`, no `new Function`, no
dynamic `import()` of user-influenced paths. Pin dependency versions with a lockfile; **no new
dependency without a stated reason in its commit message**. Security headers: CSP without
`unsafe-inline`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, HSTS.
Rate-limit every authenticated endpoint per uid. Cap request body size. Time out every outbound
call. Fail closed: on any error in an authorisation path, deny.

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

## Amendment D — Location-aware entries (adopted 2026-09-04)

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

- **INV-12** The Maps key is server-side only. It is never embedded in the client bundle, never
  returned by an API, and never placed in a URL the browser requests. Any map imagery is proxied
  same-origin so the key stays on the server *and* the narrowed `img-src` from the INV-9 backstop
  is not widened to accommodate a feature.

**7. Corpus payload.** A place name carrying an injection attempt is added to the corpus, so the
claim that the geocoding response is treated as data is tested rather than asserted.

---

## Amendment E — Roles and administrative scope (adopted 2026-09-04)

Adopted **before** any RBAC code was written, per §9.

**Why custom claims, and not the document lookup our own directives offer.**
`CUSTOM_INSTRUCTIONS.md` §3 permits RBAC via `get(/databases/$(db)/documents/users/$(uid)).data.role`.
In *this* codebase that would be a privilege-escalation hole: `firestore.rules` grants
`allow write: if isOwner(userId)` on `users/{userId}` so the profile can sync, which means the
user governed by a `role` field could set it. Self-promotion to administrator in one client
write.

A Firebase **custom claim** is signed into the ID token by the Admin SDK and cannot be altered by
the client. That is the difference between a permission and a suggestion.

**1. Data flows.** A claim set out-of-band by an operator → the ID token → `requireAdmin`. No new
user content is read anywhere in this feature.

**2. New untrusted input?** No.

**3. New egress path?** No.

**4. New secret?** No. Claims are set with existing Admin credentials.

**5. New Firestore paths?** One: `metrics/global`, holding **counters only**. Default-deny with an
admin-only read and no client write, plus rules tests written first.

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
