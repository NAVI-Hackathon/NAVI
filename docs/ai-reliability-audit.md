# AI Reliability Audit — 2026-10-27

## Scope and baseline

- Audit base: `58ec318f269ed1445bf21b234a0cd2c079ab7cb0` (A added film scripts; no product changes since `d5564d0`).
- Observed production before changes: `d5564d00a1e7c8e47618bae4345595dc4a61e46d`, HTTPS Nginx + loopback Express. No open PRs at audit start.
- Baseline: frontend 46/46 and backend 238/238. These are offline tests, not Gemini accuracy.
- No Live generation authorized for this audit. Production mode/headers are configuration evidence, not new inference evidence.
- A approved additive task-analysis and journey-correction contracts; UI wiring remains A's responsibility. Existing response schemas stay unchanged.

## Gap matrix (initial, before fixes)

| Risk | Initial status | Existing evidence | Gap / disposition |
|---|---|---|---|
| Single-service intent, negated hospitalization | Implemented + tested | intent/alignment/hospital tests; strict Gemini JSON/Zod | Add adversarial fixed evaluation cases; no new live accuracy claim |
| Multiple independent intents | Not implemented | Old prompt deliberately returns unknown | Add separate task-analysis API; require explicit task selection, no automatic journey |
| Correction of an existing hospital journey | Not implemented | Negation only guards new classifications | Add correction endpoint, invalidate old credit and retain quarantined evidence |
| Readiness and removal | Implemented + tested | Hospital, competition and alignment tests | Explicit 90% bank removal + repeat review + cross-tab races |
| Concurrent async mutations | Implemented but unverified | Upload re-reads current journey | Prevent old AI result after correction/delete; preserve independent concurrent uploads |
| Restart / cross-device state | Enterprise deployment only | In-memory TTL and session ownership | Restart expires cases; durable quota survives. No unauthenticated synchronization |
| Genuine AI evaluation | Implemented but unverified this audit | Prior limited synthetic live tests | Separate fixed mock-transport dataset and pending small Live plan |
| Grounded sources / exact excerpts | Implemented + tested | Shared evidence, extractive grounding, 134-query evaluation | Whole-inventory source/date/excerpt checks; dates are retrieval, not publication |
| Knowledge lifecycle | Implemented + tested | Approved release, publish/rollback tests, 23 approved changes | Reuse lifecycle; do not publish unreviewed data |
| Documents / consistency / no demo substitution | Implemented + tested | Live isolation, synthetic verification, hospital reliability | Adversarial response tests; mock outputs cannot establish real vision quality |
| Navigation canonical whitelist | Implemented + tested | Shared plans, full built-anchor competition E2E | Add auditable built-site inventory and production fail-closed target check |
| HTTPS / session / quota / redaction | Implemented + tested | Live-isolation/public-live tests | Recheck actual public headers and private ledger; no real personal documents |
| Enterprise authentication / CRM / legal basis | Enterprise deployment only | Prototype synthetic-only disclosure | Remain restricted to synthetic data; no actual insurer submission |
| Fault / conservative load evidence | Partially implemented + tested | Timeout/quota tests and competition E2E | Reproducible mock HTTP fault/load report with resource measurements |
| User/business benefit | Not implemented (no participant records) | No verified controlled user study | Measurement template only; no fabricated improvement percentages |
| Enterprise integration | Enterprise deployment only | Existing provider/workflow/knowledge core | Document DOM/origin/API/auth/retention adapters and cost assumptions |

Final measurements and limitations are recorded after execution; this initial table does not claim unrun checks passed.

## Completed P0 changes and evidence

- Added separate task understanding and owner-scoped intent correction; old schemas/endpoints stay compatible. No UI changes by B.
- Correcting inpatient → outpatient/unknown clears old workflow credit and hospital context. Retained evidence outside the new service is `needs_review` and contributes zero. Independent journey IDs are unchanged.
- Pending document results become stale after destructive edits; duplicate slots are rejected; actual classified type is compared with the original slot revision. Different slots still merge safely.
- Review is idempotent after completion. 90% bank removal returns 70%, cancels confirmation and invalidates stale handoff previews.
- Production navigation checks a build-generated, knowledge-hash-bound manifest. The off-VPS build audits the actual exported HTML before packaging; missing/stale targets fail closed. Source IDs and original Knowledge content are unchanged.
- Untrusted non-travel intent summaries are reduced to service-discovery wording rather than passing possible eligibility claims or identifiers to the UI.

### Fifteen high-risk backend checks

`apps/api/test/reliabilityAudit.test.js`, R01–R15: multi-task retention; invented/malformed outputs; colloquial services; correction and independent tasks; late-result correction race; bank deletion/idempotence/stale handoff; concurrent/duplicate uploads; deletion race across tabs; restart case expiry; disconnect cancellation; provider boundary/forged correction; hostile authority input; unavailable provider/no fixture; unknown clarification; zero external requests. Two additional checks cover production ownership/receipt reuse and unclassified-vs-declared same-slot races.

`documentAdversarial.test.js`: actual fixed PNG/PDF bytes (landscape, pet, blank, blurred, tilted, two-page PDF, injection PDF), strict rejection of authority fields, contradictory medical facts and names, no free-form eligibility claims. Responses are **injected mock results**. These tests prove transport/validation behavior, not that Gemini correctly recognizes or resists those inputs. Existing valid diagnosis/passbook, wrong MIME/type, account masking, low confidence, consistency, quota and no-Demo-fallback tests remain.

### Knowledge and dates

- Active KB: `kb-1404d058190e380c66eedee1`; snapshot SHA `b990f20030b7f7243e8b0ff92ae4924de4a798ea2197e515965c5e5594a77013`.
- 107 source records / 107 plans / 193 step references / 7 target pages; missing targets, source/URL mismatches and invalid excerpts: 0 in the local built-site audit.
- 134/134 Knowledge cases; Top-1 85/85, Top-3 85/85, unsupported rejection 11/11, out-of-scope 16/16; source and route invalid rates 0/208 each. Warm retrieval latency p50 0.258ms, p95 0.549ms (112 samples). Not a general accuracy estimate or Gemini evaluation.
- Individual dates, dataset crawl date and Knowledge release version remain distinct; see integration notes. No unreviewed content adopted. Previously approved 23 changes and 10 FAQ additions are not republished as new evidence.
- Existing publish/rollback/retrieval consistency tests stay active. No second lifecycle or parallel knowledge engine introduced.

### Conservative local HTTP load

`npm run test:reliability:load`: 32 synthetic journeys, 192 normal requests; concurrency 1/2/4/8, 8 flows per level. All follow 35→70→90→100. Error rate 0 in the normal runs. At concurrency 1: p50 1.16ms, p95 4.94ms; at 8: p50 5.98ms, p95 13.92ms. Combined client+server process RSS at the last level ~129.4MiB. Four injected AI faults and one invalid navigation request return the expected codes without retries or fixtures.

These short Mac loopback runs do not measure model/VPS latency, long-term reliability, maximum supported users, or user completion time. Exact machine/run data lives in ignored local `artifacts/audit-load.json`.

### Remaining acceptance boundaries

- No fresh Live calls; new multi-task prompt and adversarial vision behavior still need the separately approved small Live evaluation. Plan: `ai-live-evaluation-plan.md`.
- A must wire the additive APIs; old UI using single-intent understanding is not magically multi-task aware. iPhone Safari hardware keyboard/touch remains A's manual check.
- Public uploads remain synthetic-only. Full authenticated medical-data processing, media malware scanning, enterprise retention/legal basis and CRM delivery are not implemented.
- Cases/Sessions remain single-process and expire after TTL/restart; durable daily quota survives restart. No unsafe cross-device sync added.
- No participant records supplied: user benefit statistics are unmeasured. Enterprise adaptation/cost assumptions are in `enterprise-integration-limits.md`.
- No presentation, recording, API key, Cookie, raw personal document or private Knowledge review store is committed.

## Final local regression gate

A advanced main during the audit to `8a49718e1a49a7b36bbc03d21af2c96c7139b844` (cross-service welcome and honest recovery/preliminary-readiness wording). B rebased onto it without modifying A's files.

- Frontend 47/47; Backend 266/266 (313 total). No removed tests.
- Layout 10/10 including A's new failed-upload/retry/100%-not-submitted test; Chromium 375/390/430 and keyboard-height simulations, not real iOS.
- Legacy 120/120; Hospitalization 76/76; Knowledge 134/134; new reliability mock-transport dataset 27/27.
- Mock-site lint and `typecheck:mock` pass. No root `typecheck` script exists.
- Both production builds, shared browser bundle and competition HTTP/built-anchor E2E pass.
- Public scanner: NAVI 8 files and mock build 195 files (includes JSON, maps, HTML/RSC), 0 findings. Final static-export artifacts are scanned again by the production builder.
- New reliability cases include a partial multi-intent result rejection; no silent dropping of the rest of a request.
- External generation requests 0; added paid APIs/dependencies 0. Fresh project Free Tier/quota and genuine model performance remain unverified in this audit; no new Live evaluation was run.

Reproducible logs/job timings are local ignored `artifacts/audit-final-*.log` and `artifacts/audit-final-jobs.json`. Deployment verification is recorded separately after the release switch.
