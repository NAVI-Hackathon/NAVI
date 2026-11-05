# NAVI Ollama Cutover — Offline Preparation & Home-Server Acceptance

> **Status: PREPARATION ONLY (2026-11-05, Asia/Taipei).** This is NOT an operational cutover, deployed feature, working tunnel, or confirmed local-model evaluation. Source base: `6bc1a90d49a50344d4fde89b873bcbf622faeb38`. Create subsequent implementation PRs separately. Competition submission deadline: 2026-11-06 17:00 Asia/Taipei. No Production changes without an explicit release go/no-go.

## Objective and invariant

Eventually make a self-hosted Ollama/Qwen stack the **only active NAVI AI generation provider**. Maintain existing customer-facing behavior, rules, MongoDB Atlas persistence, Knowledge/Evidence, Workflow/Next Best Action, Navigation, and explicit local Demo. Once Ollama is active, **never silently route to Gemini**, paid APIs, or synthetic Demo outputs. A powered-off home server is an unavailable provider, not a reason to invent task success.

Do not merge this preparation into the deadline-critical A/B release. Review blocking audit fixes #33, #36, #38, #39 and their dependent PRs first. #35 deployment-manager migration is a separately authorized maintenance change.

## What existing main actually supports

- `apps/api/src/ai/provider.js`: createAIProvider currently selects Demo, Unavailable, or Gemini. Production cannot select Demo. No Ollama selection.
- `apps/api/src/config/env.js`: `AI_MODE=live` requires Gemini API key / Free-Tier attestation; has no `AI_PROVIDER=ollama` setting. Therefore simply setting `AI_MODE=live` or a different `GEMINI_MODEL` is **not** an Ollama cutover.
- `apps/api/src/services/gemini.service.js`: provider operations `converse`, `understandTasks`, `understandIntent`, `analyzeDocument`, `answerKnowledge`, `summarizeHandoff`. Preserve the exact externally validated data schemas and task semantics.
- `apps/api/src/services/providerRequest.js`: deadline and bounded error handling; do not introduce nested autonomous retries.
- `apps/api/src/ai/modelRouter.js`: Gemini-specific model discovery, HTTP, quotas, and routing; do not reuse the Google metadata API to validate a local model.
- `shared/knowledge/evidence.js`, `shared/knowledge/navigationPlan.js`, `apps/api/src/services/serviceWorkflows.js`, `apps/api/src/services/journeyService.js`: existing verified sources, navigation whitelist, deterministic readiness; Agent suggestions **must not** bypass them.
- PR #36 adds optional `clarification`/`failure` response fields; work against the *merged* final contract, not a stale SHA.
- Existing public `/demo` is a browser-local, labeled synthetic experience, not a live LLM fallback.

## Work allowed while the home computer is off

1. Implement and unit-test a **disabled-by-default** `OllamaProvider` behind an explicit new `AI_PROVIDER=ollama` (proposed name, not currently implemented). Keep `AI_MODE` semantics, preserve existing default and release behavior, and fail fast on invalid config. Do not require `GEMINI_API_KEY` or Google Free-Tier attestation **for Ollama**, but retain synthetic-only policy, session isolation, and API risk controls.
2. Introduce bounded `OLLAMA_BASE_URL` (default only for test and local development: `http://127.0.0.1:21144` on a VPS tunnel), `OLLAMA_TEXT_MODEL`, `OLLAMA_VISION_MODEL`, timeout/queue configuration. Reject public hosts, ambiguous redirects, external proxies, unsafe URLs and invalid model names in production; do not persist secrets in source.
3. Use Ollama's `POST /api/chat`, `stream:false`, with `format` set to a JSON Schema and `messages` with system/user content. Parse `message.content` and validate through **existing** Zod schemas, then apply existing source-ID, task, document, user authorization and workflow validation. Do not mistake JSON validity for semantic correctness.
4. Build a transport-injected Mock with synthetic successful, malformed, refused, timeout, connection-refused, aborted, lost-tunnel, invalid-source and multi-task cases. No real Google, Ollama or Atlas calls in automated offline tests. Record denominator/sha.
5. Define a **safe vision pipeline** but do not claim completion: born-digital PDF text extraction, scanned PDF rasterization with bounded pages/size, image/vision model candidate output, field-by-field consistency validation, `needs_review` on uncertainty. Qwen3 4B Instruct 2507 is a text model; do not feed raw PDF/PNG bytes to it expecting image understanding. Compare installed Qwen3.5 4B with a possible Qwen3-VL 4B after the host is online.
6. Prepare a local smoke script that only talks to a user-approved localhost URL and **only runs when invoked explicitly** after server startup. No startup-time generation and no automatic live benchmark.
7. Preserve `AI_MODE=unavailable` and read-only Knowledge routes. On Ollama failure: typed public `failure`, retrieval-only response with `understanding=null`, no new task/mutation, no renderer crash, no hidden Gemini or Demo fallback.
8. Keep all new files on an isolated non-production branch. Do not merge, deploy, restart systemd, change SSH users/keys, touch Atlas roles, or switch providers without operator authorization.

## Secure home-to-VPS transport design (not yet connected)

Home Ubuntu (Ollama bound at `127.0.0.1:11434`) initiates a **dedicated** SSH reverse tunnel to a dedicated low-privilege VPS account. Provisional remote address: `127.0.0.1:21144` (choose only after checking it is unoccupied; avoid Adrift's existing gateway and NAVI API ports). SSH `-R 127.0.0.1:21144:127.0.0.1:11434` and `ExitOnForwardFailure=yes`, keepalive, separate key; enforce authorized_keys and sshd restrictions (port-forward destination, no shell/agent/X11/PTY where practical). Do not set `GatewayPorts yes` and do not open the port publicly.

Review **live VPS systemd networking sandbox** before binding any new loopback client; prior NAVI releases have restrictive network access and MongoDB Atlas egress rules. Prove that only authorized NAVI service processes can access the private tunnel (loopback by itself is not an API authentication system), and ensure Adrift and NAVI are isolated by credentials, tool permissions, service budgets, and logs. If access control cannot be established safely, fail closed.

The reverse tunnel itself can report established even while the final local Ollama endpoint is unreachable. Add an application-layer health probe to check Ollama model availability, including a real bounded inference only when explicitly permitted.

## Proposed model and resource envelope (unverified in NAVI production)

Text/Agent candidate: `qwen3:4b-instruct-2507-q4_K_M`.
Vision comparison candidates: already-downloaded `qwen3.5:4b`, optionally `qwen3-vl:4b-instruct`.
Home GPU RTX 2060 SUPER 8 GiB; default single active inference, explicit small queue, 4K initial context, cap model/tool rounds, input limits and image sizes. Avoid assuming two 4B models can remain resident. Benchmark cold/warm first-token and end-to-end latencies, VRAM, RAM, Swap, failures, and Adrift contention. No claims of production readiness from historical 300-run weighted tests; documented strict case success 8/20 demands further holdout tests.

## Offline validation gates before user returns home

- CI/local test: old Gemini/default config behavior unchanged; production refuses `AI_MODE=demo`; Ollama selection only via explicit config, never enabled by loading a module.
- Provider-method mocks: all six existing methods, structured schema parsing, bounded concurrency, signal cancellation, timeout, invalid response, tool-call hallucination blocked, no external URLs or outbound API calls.
- Audit E13: retrieval/timeout/quota response is render-safe when A's fix is merged.
- No automatic retry on disconnect, no automatic Gemini fallback, no charge to Google Free Tier.
- `npm test`, `npm run lint`, `npm run build:all`, relevant Playwright tests and security scans; preserve known flaky failures. Report which suites were **actually run** and do not claim home Ollama connectivity.

## Checklist when the user powers on Ubuntu

- [ ] Check `systemctl status ollama` and `curl --fail http://127.0.0.1:11434/api/version` **on home Ubuntu**.
- [ ] Check `ollama list` for exact model tags, `nvidia-smi`, RAM and disk; verify Qwen text model and candidate vision model exist.
- [ ] Generate/approve dedicated SSH key and limited VPS tunnel account; verify key, host fingerprint, no public bind, proper port ownership, no collision.
- [ ] Establish tunnel from home and verify from VPS: `curl --fail --max-time 3 http://127.0.0.1:21144/api/version` (after port selection and access-control review). This is a connectivity check, not a text-generation test.
- [ ] With separate explicit authorization, run **bounded synthetic** `/api/chat` smoke evaluation and Zod validation, including 1 known-good and negative cases.
- [ ] Run full text intent/clarification/knowledge/nav tests, then vision documents, local holdout, concurrency and outage scenarios; do not count Mock as true model correctness.
- [ ] Run staging E2E without altering Production; record commit SHA, model tag/quantization, context, resource use, p50/p95, citations, wrong-nav, hallucinations, partial results.
- [ ] Production cutover requires a separate go/no-go (demo stability, PR integration, rollback plan, privacy policy and human approval).

## Operator-approved deployment gate

This document is **not** release approval. Do not update the production environment `AI_MODE`, `GEMINI_API_KEY`, `GEMINI_MODEL`, VPS systemd, SSH policy, MongoDB, DNS, public endpoints, or existing private keys until explicit approval. Never delete Gemini credentials during preparation. Avoid blocking the 2026-11-06 submission with an unvalidated home-server dependency.

Official references: https://github.com/ollama/ollama/blob/main/docs/api.md (chat, format, tools, keep_alive); https://man.openbsd.org/ssh.1 (reverse tunnel syntax).
