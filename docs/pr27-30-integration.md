# PR #27 / #29 / #30 integration release

The three A PRs are already merged at `53aa99b9cf4e417917d7277495a0d2f862618df6`. This patch preserves their workspace, task selection, upload states, accessibility, styles and motion. A3 stays in draft PR #28.

## Compatible behavior corrections

- Failed task selection retains the selected task and independent pending tasks. Late Journey selection, document and handoff responses cannot overwrite a newly selected Journey.
- Already-aborted native XHR uploads reject immediately. Real upload progress is based on native byte events; analysis starts after the upload event, not a fabricated percentage.
- AI status is taken from a successful, consistent API body/header pair. A failed or conflicting status clears the old mode. Production refuses missing/blank/demo AI_MODE and incomplete/unapproved Live configuration. Explicit `unavailable` is supported. Local development still supports explicit/default Demo.
- `host:navigated` keeps numeric protocol-v1 IDs, exact origin and source-window validation. Random request IDs prevent reuse after iframe reload. Stale, duplicate and timed-out acknowledgements are ignored. The host confirms no-anchor destinations only after the actual router pathname arrives; it does not report a highlight for a page without an anchor.
- Date arithmetic is shared in `describeHospitalStay`: valid ISO dates yield inclusive calendar span and nights, separately from document-printed days. Missing/invalid/reversed dates remain unknown. The 2026-10-01–2026-10-05 example is five calendar days / four nights; it contains no printed medical/benefit day count. The UI never animates this factual value from zero. Existing document JSON fields and Readiness rules remain unchanged for older strict-schema clients.
- Contract-change form navigation remains one relevant step. Address change remains two distinct targets (service instructions, then the related form), without extra unrelated services.

## Evidence boundaries

Local formal-client Browser E2E uses the real Express routes and Gemini provider with Mock HTTP transport. PDF inline bytes are checked against the independently regenerated synthetic PDFs; structured responses remain scripted. These tests do not measure the Google model or establish document authenticity. Android is Chromium device emulation, not a physical phone test. iPhone Safari remains A's physical-device acceptance.

No new Gemini generation or paid request is required by this release. Production mode/budgets are inspected independently of local test mode. Do not infer current Free Tier account eligibility solely from configuration flags.

## Storage/privacy boundary for A

This release retains InMemory Journey storage and browser references, not an enabled Atlas account/history service. Browser removal only forgets a Journey reference; individual document and manual-information removal calls are real server DELETE operations. Do not promise permanent account history, whole-Journey deletion, cross-device recovery or a storage guarantee that depends on the unactivated A3 service. A3's owner-scoped APIs, generated JSON Schemas, retention and backup deletion boundaries are documented separately in draft PR #28 (`docs/a3-persistence-contract.md`).
