# NAVI production runtime

This release extends the existing Express / React application. It does not replace the Knowledge Engine, hospital workflow, Navigation Plan, or local Demo adapter. Developer A authorized the shared contract and minimal history/account/checklist integration; existing layouts and motion tokens remain.

## Runtime and privacy

Node **22.23.3** uses the official MongoDB driver with Atlas-backed asynchronous repositories and snapshot transactions. No database server runs on the VPS. See [A3 contract](a3-persistence-contract.md). JSON records are encrypted with AES-256-GCM, including authenticated owner, namespace, expiry, and revision. The key stays in the root-only production environment, outside releases and Git. Atlas requires a dedicated database, scoped user and network allowlist. Local backup/transient directories require private ownership/permissions. The encrypted state is outside release directories and survives updates/restarts.

Accounts use salted scrypt passwords; opaque 256-bit cookies are HttpOnly, Secure, SameSite=Strict. Mutations require an allowed Origin. Owners and server-side intent receipts authorize journeys; IDs alone grant nothing. Anonymous sessions persist for 30 days. Optional accounts recover history on other browsers. Email verification and one-use password recovery are implemented with an injectable SMTP transport; actual delivery requires an authorized SMTP configuration. Enterprise identity federation is not provided. Account credentials persist until account deletion; journey/conversation data has a configurable 30-day retention. Backups are private, encrypted, automatically rotated after seven days. Delete/export apply only to the authorized owner. Restore can reintroduce backup-era data; use it only for disaster recovery and honor deletion requests before reopening access.

**Google unpaid-service terms prohibit sensitive/personal/confidential information.** Public uploads therefore remain synthetic-only with explicit disclosure/consent, even though arbitrary permitted synthetic files are accepted. Real personal medical/bank processing requires an authorized data-processing arrangement and legal/privacy approval. No paid billing was enabled by this change. Raw PDF bytes are briefly written to a generated private folder for validation and deleted in `finally`; stale temporary folders are cleaned after interrupted processing. Images are decoded through a bounded child process. Clinical narratives/full account numbers are excluded from the extraction schema and logs.

## Model router and resource management

`AI_MODE=live` uses the real REST provider. `/demo` and embedded Demo use the existing browser-local adapter. Failure never invokes the Demo provider. Structured schemas, intent normalization, document checks, consistency checks, and readiness remain mandatory after every model switch.

The Models API inventories `generateContent` availability; it does **not** prove image/PDF/schema capability, free entitlement, or remaining quota. Configured model policies additionally record reviewed capabilities, tier, and official documentation. Only models passing both gates are routed. Model quota exhaustion may select another compatible approved model; project-wide/ambiguous quota exhaustion stops routing. No API-key rotation is used. Schema/safety rejection stops without fallback. Transient 503/404/network/attempt timeout has bounded backoff and a finite attempt count. Every attempted generation, including errors/switches, is reserved in the durable daily ledger and session counter. Queue waiting does not charge a generation. Failed requests are conservatively counted.

Configuration (deployment-specific, not immutable product limits):

| Setting | Product default / meaning |
| --- | --- |
| `NAVI_PRODUCT_MODE` | opt-in `true`; old APIs stay compatible |
| `MONGODB_URI` / `MONGODB_DATABASE` | dedicated authenticated Atlas SRV / NAVI database |
| `NAVI_PRIVATE_STATE_PATH` | absolute private temporary/backup directory |
| `NAVI_DATA_ENCRYPTION_KEY` | independent 32-byte base64 key; never public |
| `NAVI_RETENTION_DAYS` / `NAVI_SESSION_DAYS` | 30 |
| `AI_MODELS_JSON` | ordered `{id,capabilities,tier,confirmed,documentation}` policies |
| `AI_DAILY_REQUEST_LIMIT` | 400; must remain below actual approved project quotas |
| `AI_SESSION_REQUEST_LIMIT` | 0 = no lifetime cap; independent rate protection remains |
| `AI_SESSION_REQUESTS_PER_MINUTE` | 10 per session |
| `AI_REQUESTS_PER_MINUTE` | 12 across the pool |
| `AI_MAX_CONCURRENT` | 3; image/PDF jobs have greater queue weight |
| `AI_QUEUE_LIMIT` / `AI_QUEUE_TIMEOUT_MS` | 30 / 10000 |
| `AI_TIMEOUT_MS` / `AI_REQUEST_TIMEOUT_MS` | 10000 per model / 40000 total |
| `AI_ROUTE_MAX_ATTEMPTS` | 3 maximum attempts, never unbounded |
| `ALLOW_PAID_AI` | false in the deployed configuration |
| Paid options | require billing confirmation, explicit authorization, paid-only policies with conservative per-request cost reservation, and positive daily cost budget; never auto-enabled |

When generation is unavailable, conversation responses explicitly use `mode=retrieval`, `understanding=null`, and an error code. Exact verified snapshot evidence remains usable; no AI interpretation is fabricated. The header reports the configured actual provider boundary (`live` / `unavailable`), while the conversation mode distinguishes a specific non-generative reply. `isMock` is false only for the real live pipeline; Mock Transport tests are labeled separately.

## Additive APIs

All routes are under `/api`. Existing routes and fields remain. See `shared/product.js` and `shared/journey.js` for validation.

- `GET /session`: persistent session, consent and permitted upload capabilities.
- `POST /session/consent`: `{syntheticOnly:true,disclosureVersion:"gemini-unpaid-2026-10"}`.
- `POST /auth/register`, `POST /auth/login`: `{username,password}`; salted password authentication, no email/PII required.
- `POST /session/logout`: revoke the current session.
- `GET /history`: authorized journey and conversation metadata.
- `POST /conversations/messages`: `{message,requestId,conversationId?}`. One generation understands tasks and supplies a source-bound answer. Durable idempotency prevents repeated generation for the same request ID; changed input with the same ID is rejected. The persistent context contains normalized tasks, not unrestricted medical narratives.
- `GET /conversations/:id`: authorized neutral history.
- `GET /service-workflows/:id`: approved source/checklist/navigation for supported simple services.
- `POST /journeys/:id/checklist`: ordered `checked` IDs and current integer `revision`; stale writes return `JOURNEY_STALE`.
- `GET /account/export`, `DELETE /account/data` with `{confirmed:true}`.
- `DELETE /journeys/:id`: delete only an owned journey.
- `GET /journeys/:id/handoff/download`: available only after the existing redacted preview/confirmation. No insurer ticket is created or sent.
- `GET /ready`: database integrity and Knowledge version readiness.
- `GET /ops/status`, `POST /ops/backup`: root-managed bearer token (at least 32 characters), sanitized metrics/backup only; not a public dashboard.

Optional journey fields: `revision`, `workflowId`, `checklist`. Optional document fields: `contentSha256`, `missingFields`, `fieldConfidence`, `confidenceBasis`. Field confidence is an **uncalibrated model estimate**, not proof of correctness. Missing fields remain null. Hashes identify duplicate uploaded bytes, not document authenticity or upload authorization. Production accepts structurally valid PDF (up to 20 pages), PNG/JPEG/WebP; Linux qpdf and Pillow must be installed before enabling product mode. Declared type is checked against actual content and model classification.

## Service workflows

The hospital score remains **35 → 70 → 90 → 100**. Document removal, correction, conflict, or revalidation revokes the corresponding points/confirmation.

Outpatient, address, contract-change form, payment change, beneficiary change, and loan preparation reuse the approved Knowledge Engine and navigation whitelist. Their simple sequential checklists represent **self-confirmed preparation**, not AI-verified documents or insurer eligibility. Low confidence or unresolved outpatient evidence forces human review and prevents completion. These services do not pretend that an application was submitted. No stable direct contract-change PDF URL exists in the approved snapshot; NAVI links the verified official form-information page rather than inventing a file.

## Operations, backup and restoration

Persistent data is in the dedicated Atlas database. Local encrypted backups and temporary validation files are under `/opt/navi-hackathon/run/state`. Systemd permits only the NAVI run directory to be written. The API performs cleanup and daily encrypted, signed snapshot backups; `/ops/backup` or `storage/admin.js backup` can trigger one immediately. Monitor `/ops/status`, `/ready`, journal errors, queue saturation, model health, and daily attempts.

To run the storage CLI, use the NAVI runtime as its service account with a root-managed environment (do not make the environment public): `node apps/api/src/storage/admin.js backup`. Restoration uses a separately scoped empty restore database and environment, then `node .../admin.js restore <validated-private-backup> --confirm`. It refuses a populated or non-dedicated restore database, invalid signature, wrong key, corrupt records, symlink, or newer schema. It writes to a separate empty restore database rather than replacing the live database. Restart NAVI and check `/ready`. Keep a separate controlled copy of the encryption key; losing it makes encrypted backups unusable.

The dedicated release manager now snapshots and atomically restores **both release and environment** on activation failure/rollback. Data is outside both and is not silently deleted or downgraded. Knowledge operations continue through the existing signed-review `knowledge:import` → `knowledge:review` → `knowledge:publish` / `knowledge:rollback` pipeline; publish is validated locally and shipped in a tested release. No unreviewed crawl is hot-loaded into public answers. Model/status audit events contain metadata only, not document contents or credentials.

## Validation and external dependencies

`npm test`, `test:product`, `test:layout`, `test:e2e`, `eval:ai:local`, `eval:hospitalization`, `eval:knowledge`, `eval:reliability:local`, `test:navigation`, `lint`, `typecheck:mock`, `build:all`, and `security:public` are offline/Mock Transport checks. Browser product tests exercise the real UI, Express, encrypted MongoDB, consent, server model router and mocked Google transport. They do not measure real Gemini accuracy.

No new Gemini generation is authorized for this work. Models metadata and AI Studio quota visibility can be checked without generating content. Actual multi-model/updated-conversation AI quality and latency remain pending a separately approved synthetic Live budget; do not describe the Mock Transport result as a new real-model evaluation.

Official references: [MongoDB transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/), [Models API](https://ai.google.dev/api/models), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [data handling terms](https://ai.google.dev/gemini-api/terms).
