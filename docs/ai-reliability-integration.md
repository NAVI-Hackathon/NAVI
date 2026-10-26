# Developer A integration — reliability contracts

A approved this additive scope on 2026-10-27. No UI, animation, Guided Action or old shared response schema was changed.

## Multiple independent tasks

`POST /api/intelligence/tasks` with `{ "message": "我想改地址，也想知道要怎麼申請住院理賠。" }`.

Response (`shared/serviceTasks.js`):

```json
{
  "tasks": [
    {"id":"task-1","input":"我想改地址","data":{"intent":"service_request","serviceType":"policy_change","confidence":0.9,"summary":"使用者希望了解保單資料變更的辦理方式。","extractedData":{"origin":null,"destination":null,"delayMinutes":null,"incidentDate":null}},"outcome":"preview"},
    {"id":"task-2","input":"想知道要怎麼申請住院理賠。","data":{"intent":"service_request","serviceType":"hospitalization_claim","confidence":0.9,"summary":"使用者回報住院情況，希望了解醫療理賠申請流程。","extractedData":{"origin":null,"destination":null,"delayMinutes":null,"incidentDate":null}},"outcome":"supported"}
  ],
  "nextStep":"confirm_one_task","provider":"live","isMock":false,
  "disclaimer":"請先確認要處理的項目；各項任務分開進行，不會自動建立旅程或判斷理賠資格。"
}
```

Illustrative contract example, **not a real Gemini result**. Each input is a literal substring of the submitted message. Maximum four items. This is one structured generation, not one per task. Keep all returned tasks visible until the user chooses an item; do not discard the others. Task IDs are response-local, not durable case identifiers.

- `supported`: explicitly confirm that item, then use existing `POST /api/journeys` with `message=task.input`. A server-side receipt in the same protected Session can reuse the trusted understanding for five minutes; never trust browser-supplied facts.
- `preview`: use existing grounded Knowledge / Navigation APIs for the selected task; only supported services have a full journey.
- `clarification` / `human_review`: ask for details / offer specialist summary. Never claim coverage or payout.
- Legacy `/api/intelligence/understand` remains single-intent. **A must opt in to the new tasks endpoint** for multi-task chat; the current deployed UI is not automatically rewired.
- The synthetic-only Session and durable daily budget apply. `X-NAVI-AI-Mode` identifies the actual provider boundary. A mock transport test reporting `live` only means the production provider code path was exercised, not genuine inference.

## Correct an existing journey

`POST /api/journeys/:id/intent-correction` with `{ "message": "我其實不是住院，是門診。" }`.

Returns `{ journey, previousServiceType, evidenceRetained:true, requiresRevalidation:true }`. `journey` still validates against the existing `ServiceJourneySchema`.

- Read the returned state; do not carry forward the previous score, action, sources or claimContext.
- Negated hospitalization becomes an unsupported/unknown workflow with 0 readiness. Old documents are retained as `needs_review`, with no matched requirements or credit. No invented outpatient claim workflow.
- Other journey IDs and their documents remain untouched.
- A new valid hospital description uses the same deterministic rules and actual consistency checks; `requiresRevalidation` does not mean insurer approval.
- Show retained evidence as requiring confirmation; never call it a verified document for a new unsupported service.
- This endpoint invokes AI and requires the original owner Session. Use only synthetic text. No raw correction narrative is retained.

## Races, idempotence and errors

- `JOURNEY_BUSY` (409, retryable): the same document slot is still analyzing; avoid duplicate submission.
- `JOURNEY_STALE` (409, not automatically retryable): a removal, correction, confirmation or manual-data change invalidated an in-flight result. Refetch the journey and ask the user before retrying.
- Different document slots can complete concurrently without losing one another.
- Repeated review after completion returns the unchanged journey; it does not keep changing the handoff revision.
- Existing AI_TIMEOUT / AI_BUSY / AI_DAILY_LIMIT_REACHED / AI_USAGE_UNAVAILABLE / TEST_SESSION_* formats remain unchanged. No hidden Demo fallback.
- On service restart, Sessions and journeys expire (404 / TEST_SESSION_REQUIRED). A browser refresh with a live Session can reload the server state; restart is not cross-device persistence.

## Navigation validation

Existing `/api/navigation/plans` response is unchanged. Production requires a generated, release-local `data/navigation-targets.json`, produced from the **actual static mock-site build**. Missing targets, wrong source mappings or an outdated knowledge hash return `NAVIGATION_TARGET_UNAVAILABLE` (503, not retryable). Offer source viewing instead of pretending the target was reached.

`npm run test:navigation` audits all plans against built HTML; `scripts/evidence/navigation-audit.js <static-dir> <report-file>` generates the manifest. The off-VPS production builder generates and packages it automatically. Runtime verification covers our mock-site release, not the real insurer DOM.

## Knowledge dates and versions

Active release: `kb-1404d058190e380c66eedee1`, 107 source records. No Knowledge content changed in this audit.

- `source.retrievedAt`: individual retrieval date (new FAQ13–22: 2026-10-21).
- `source.publishedAt`: absent unless actually published by the source; do not invent it.
- `dataset.meta.crawled`: 2026-10-26, dataset capture/organization date; not every source's date.
- `dataset.meta.legacyRetrievedAt`: 2026-10-06 for unchanged older entries missing their own date.
- `knowledgeVersion` and `releasedAt`: NAVI release metadata, not official insurance publication dates.
- Use `/api/knowledge/version` and `/api/knowledge/versioned-evidence`; keep the optional source-version label already present. The locally delivered updated deck uses this same release; presentation files stay outside Git.
