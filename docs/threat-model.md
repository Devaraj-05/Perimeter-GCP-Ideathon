# Threat model

The Threat Summary Tables the Production Directives require, consolidated by threat zone.
Each row maps a threat to the countermeasure that addresses it and the file that implements it.
This is a record of the analysis done *before* each feature was built; the git history shows the
constitution amendment preceding the code in every case.

The five threat zones are the ones named in Directive 1.

## Input Surfaces

| Threat | Countermeasure | Where |
|---|---|---|
| Malicious instructions in pasted/fetched content | Screened by L1 + L2, then only ever read by the toolless Reader | `detect.ts`, `classify.ts`, `reader.ts` |
| Hidden payloads (HTML comments, white-on-white text) | `extractText` retains comments and CSS-hidden text so they are screened, not stripped | `fetchurl.ts` |
| Instructions planted in a repository an agent is pointed at | Scanned by a path that runs no model at all (INV-18), so there is nothing present to instruct; files an agent is built to obey are read first | `reposcan.ts` |
| A repository large enough to exhaust the scan | 500 files, 256 KB per file, 5 MB total, 60 seconds; whichever trips first ends the scan and is named in the coverage line rather than hidden | `reposcan.ts` |
| A partial scan read as a clean bill of health | Coverage states files read, files skipped and which cap stopped it; never phrased as "no injections in this repository" | `reposcan.ts` |
| Oversized input / DoS | 10 MB body cap; 2 MB fetch cap enforced while streaming; per-segment cap | `server.ts`, `fetchurl.ts`, `segments.ts` |
| Malformed request bodies | Guarded destructuring; malformed JSON returns a clean 400 | every handler; `server.ts` |

## Planning & Reasoning

| Threat | Countermeasure | Where |
|---|---|---|
| Indirect prompt injection (LLM01) | Dual-model airlock: the Reader that sees untrusted text has no tools; the Planner never sees raw untrusted text | `reader.ts`, `planner.ts` |
| System-instruction bypass | Untrusted text occupies the user position only; `assertNoUntrusted` throws before dispatch | `planner.ts`, `segments.ts` |
| Delimiter/fence escape | Fence and role markers stripped from the payload before assembly | `reader.ts` |
| Tool-routing hijack | The model proposes; a pure Broker decides; nothing executes inline | `broker.ts`, `agent.ts` |

## Tool Execution

| Threat | Countermeasure | Where |
|---|---|---|
| Injection-driven side effects | Every write-class tool is held for a human click regardless of any standing grant (S2); tainted egress additionally needs a fresh one | `broker.ts` |
| Laundering untrusted text into a trusted turn | A note the agent wrote carries `createdBy: 'agent'` and stays tainted when reloaded as context, so a poisoned document cannot be promoted to first-party across a turn boundary | `agent.ts`, `execute.ts` |
| Double execution of a non-idempotent action | `/approve` claims the call in a transaction; one-shot grants are claimed transactionally before the tool runs, not consumed after | `agent.ts`, `capabilities.ts` |
| Unauthorised actions | Deny by default; every tool needs a live capability grant the user created | `broker.ts`, `capabilities.ts` |
| Invented tool names | Static registry; an unknown tool is a dead end | `tools.ts` |
| Stale approvals | Policy re-evaluated at execution time, not enqueue time | `agent.ts` |
| Privilege escalation via self-granting | No mint tool exists; grants are created only by a user click; rules deny client writes | `firestore.rules`, `capabilities.ts` |
| SSRF | HTTPS-only, every resolved address range-checked, redirects re-validated | `fetchurl.ts` |
| Quota exhaustion | Per-user hourly limits; per-tool registry limits | `ratelimit.ts`, `tools.ts` |

## Memory & State

| Threat | Countermeasure | Where |
|---|---|---|
| Cross-user data access | Owner-bound rules; 66 adversarial tests | `firestore.rules`, `tests/firestore.rules.test.ts` |
| Provenance laundering | `segments.zone` and `artifacts.trust` are client-unwritable | `firestore.rules` |
| Verdict laundering | `artifacts.verdict` client-unwritable | `firestore.rules` |
| Self-approval by DB edit | `toolcalls` client-unwritable | `firestore.rules` |
| Audit tampering | Append-only at the rules level; create also denied; hash-chained | `firestore.rules`, `perimeterLog.ts` |
| Forged identity | uid only ever from the verified token | `auth.ts` |

## Inter-System Communication

| Threat | Countermeasure | Where |
|---|---|---|
| Token/secret leakage | Secret Manager → runtime; never sent to the browser, logged, or committed | `secrets.ts`; `inv8.test.ts` |
| Attacker text quoted back as evidence | Match excerpts render as escaped React text children — no markup, no linkification, and no markdown interpretation, so the quotation is faithful and inert | `InjectionReport.tsx` |
| Evidence a user could edit to clear their own findings | `artifacts.matches` is client-unwritable, like every other input to a decision | `firestore.rules` |
| Exfiltration by rendered resource URL | Untrusted/derived text rendered escaped, never as HTML, never as an image source | `UntrustedText.tsx` |
| Exfiltration to an attacker destination | Egress tools take an opaque id the server resolves; an address in the payload can never become the destination | `tools.ts`, `broker.ts` |
| Unauthenticated scheduled ingest | Cloud Run IAM plus an in-app OIDC identity check; unset config closes the endpoint | `internal.ts` |
