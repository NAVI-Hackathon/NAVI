# A3 — MongoDB Atlas persistence and authentication

## Integration status

Developer B implements the contract; Developer A owns the visual design and final A3 flow. The user authorized additive Backend/shared functionality and minimal history/recovery controls. This supersedes the earlier SQLite proposal. **No MongoDB server runs on the VPS.** The new product path uses the official `mongodb` driver, real asynchronous repositories and MongoDB transactions; InMemory is retained only for legacy/Demo tests and the current, unswitched release. Setting `NAVI_PRODUCT_MODE=true` without a connected Mongo store fails startup, rather than silently falling back to memory.

Atlas credentials and production email delivery are external prerequisites. Local integration tests use an isolated actual MongoDB replica set, never Atlas or a fake database. They do not establish Atlas production connectivity or real email delivery. Do not switch all public APIs to required authentication before A's login/history integration is verified.

## Configuration and provisioning

Secrets belong only in `/opt/navi-hackathon/config/api.env` (root-only), never Git, browser variables or chat. Configure:

| Name | Requirement |
| --- | --- |
| `NAVI_PRODUCT_MODE` | `true` for persistent product mode |
| `MONGODB_URI` | dedicated Atlas `mongodb+srv://…`, authenticated TLS; no disabled certificate checks |
| `MONGODB_DATABASE` | dedicated `navi` or `navi_<suffix>` database; system/other-project names rejected |
| `NAVI_DATA_ENCRYPTION_KEY` | independent random 32-byte base64 key; back up separately under access control |
| `NAVI_PRIVATE_STATE_PATH` | private directory, e.g. `/opt/navi-hackathon/run/state`; generated transient files and encrypted backups only |
| `NAVI_AUTH_REQUIRED` | enable only for the coordinated A3 cutover; otherwise old synthetic Session compatibility remains |
| `NAVI_AUTH_REQUIRE_VERIFIED_EMAIL` | `true` for public email accounts |
| `NAVI_PUBLIC_APP_ORIGIN` | trusted HTTPS app origin, used to construct recovery links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | authorized delivery service; TLS required, protocol debug disabled |
| `NAVI_RETENTION_DAYS`, `NAVI_SESSION_DAYS` | default 30; validated bounds |

Create a database user with **readWrite only on the dedicated NAVI database**, restricted to the NAVI cluster. Enable Atlas network access for the VPS `/32` only. Do not use a global admin, unrelated database or `0.0.0.0/0`. Migration creates indexes and collections within this database; it does not administer Atlas users or billing. Free Atlas has service/storage/backup limits; this implementation does not enable paid cloud backups. Exported encrypted, signed application snapshots provide a separate tested backup path. Actual Atlas plan, network path and permissions must be verified before cutover.

## Data model

Every encrypted record has `_id`, server-derived `ownerId`, `revision`, `expiresAt` and authenticated ciphertext. The AES-256-GCM AAD binds namespace/ID/owner/expiry/revision; moving ciphertext between owners fails authentication. MongoDB TLS and Atlas access control remain mandatory; field encryption does not replace them.

| Collection | Contents / constraints |
| --- | --- |
| `users` | hashed normalized account identity as unique `_id`; encrypted email, salted scrypt password hash, email verification state |
| `auth_sessions` | SHA-256 of a random opaque Cookie, owner, consent, counters; TTL/revocation |
| `journeys`, `journey_owners` | existing Journey contract, CAS revision, explicit owner linkage |
| `journey_documents` | encrypted metadata/extracted minimal fields; no raw files, no full bank account or diagnosis narrative |
| `journey_events` | state/score changes without document content |
| `task_batches`, `tasks` | trusted structured result, owner/session, status, Knowledge version, reserved Journey UUID |
| `operation_receipts` | five-minute action authorization/idempotency; distinct from retained task facts |
| `handoff_drafts` | versioned, minimized notes bound to Journey revision; never a ticket |
| `handoff_previews`, `handoff_confirmations` | redacted consent workflow; preview expires after ten minutes |
| `conversations`, `conversation_requests` | neutral recoverable history and durable request idempotency |
| `usage_budgets`, `model_health` | durable cost/request counters and circuit state |
| `knowledge_releases` | integrity-checked published release metadata observed at startup |
| `audit_events`, `schema_migrations` | sanitized operational events; repeatable schema version 1 |

Indexes include unique `_id`, TTL expiry, owner/expiry lookup, owner + stable updatedAt/id Journey ordering, owner/Journey linkage and session tasks. Queries explicitly filter expiry; they never depend on the asynchronous TTL monitor deleting an expired row immediately. Journey/document/event/task changes, cascades, owner migration, draft CAS and token consumption use transactions. Different tabs cannot silently overwrite the same revision. Model calls and email delivery occur **outside** DB transactions, so transaction retry cannot duplicate a Gemini generation or email.

## Authentication and origin boundary

- Cookie: `__Host-navi-session`, Secure, HttpOnly, SameSite=Strict, host-only `/`; 30-day expiry by default. It is separate from legacy `__Host-navi-test`.
- API never accepts a client `ownerId`/`userId` as authority. Successful login rotates the session; logout revokes the current session. Password reset revokes all account sessions.
- Allowed Origin is required on mutations; CORS is explicit, credentials allowed only for trusted origins. `navitw.com` embeds `app.navitw.com`, a same-site subdomain; all API requests remain on the app origin. CSRF controls must not be disabled to fix iframe behavior.
- Password hashing: per-user random salt, Node scrypt N=16384/r=8/p=1, 64-byte result, constant-time comparison. Login/registration/recovery share a bounded per-IP limiter. No access token is stored in localStorage.
- Email verification/recovery tokens are random, one-use, stored only as hashes and expire after 30 minutes. Links put the token in the URL fragment, not the query or API logs. Generic request responses avoid claiming that an unknown address has an account.
- A requires valid account auth for the new private list/task/draft APIs. Existing endpoints retain a controlled compatibility flag until the A3 coordinated switch. This is not permission to open real sensitive uploads.

## Endpoints

Existing error envelope remains `{success:false,error:{code,message,retryable}}`. All examples omit Cookie values.

| Method/path | Input / result |
| --- | --- |
| `POST /api/auth/register` | `{email,password}`; 201 `{authenticated:true,emailVerified:false}`. Public required-auth registration rejects unconfigured email delivery. Test-only username compatibility is not the formal email account workflow. |
| `POST /api/auth/login` | `{email,password}`; rotates Cookie, returns auth/verification state |
| `POST /api/auth/logout` | `{}`; revoke current session |
| `GET /api/auth/me` | `{authenticated:true,user:{id,email,emailVerified}}`; no password hashes/tokens |
| `POST /api/auth/verification/request` | `{email}` → `{accepted:true}` when appropriate; no token returned |
| `POST /api/auth/verify-email` | `{token}` → `{success:true}` |
| `POST /api/auth/password/forgot` | `{email}` → generic `{accepted:true}` |
| `POST /api/auth/password/reset` | `{token,password}` → `{success:true}`; all old sessions revoked |
| `GET /api/session` | availability, consent, authentication requirement, retention and synthetic upload capability |
| `POST /api/session/consent` | `{syntheticOnly:true,disclosureVersion:"gemini-unpaid-2026-10"}` before any model request |
| `GET /api/journeys?limit=20&cursor=…` | `{items,nextCursor}`; limit 1–50, stable updatedAt DESC then id DESC |
| `GET /api/journeys/:id` | existing Journey fields plus optional `revision`, `workflowId`, `checklist` |
| `DELETE /api/journeys/:id` | `{deleted:true,id,deletedAt}` only after cascade commits |
| `GET /api/sessions/current/tasks` | current session tasks for the authenticated owner |
| `GET /api/tasks` | authorized account-level recovery across new sessions/devices |
| `POST /api/journeys` | additive `{taskId,idempotencyKey}` UUID request; resolves saved facts without another Gemini request |
| `GET /api/journeys/:id/handoff/draft` | `{draft:null}` or `{draft:{journeyId,text,version,journeyVersion,updatedAt,delivery:"not_sent",stale}}` |
| `PUT /api/journeys/:id/handoff/draft` | `{text,version,journeyVersion}`; version 0 creates, subsequent version must match |
| `DELETE /api/journeys/:id/handoff/draft` | `{deleted:true}` |
| `GET /api/account/export` | authorized export; never passwords, secrets, raw uploads |
| `DELETE /api/account/data` | `{confirmed:true}`; owner-wide transaction, account/sessions removed |
| `GET /api/ready` | verified DB readiness/Knowledge version; DB failure is 503 |

Journey list items contain only: `id`, `serviceType`, `title`, `currentStage`, `readiness`, `updatedAt`, `createdAt`, `version`, `hasHandoffDraft`. No document fields or draft content. A foreign/nonexistent Journey returns the same 404. The frontend must not show deletion success until the API successfully commits.

A task response contains `taskId`, `batchId`, minimized `input`, `summary`, `serviceType`, `status`, timestamps, version and Knowledge version. The old `task-1…4` identifiers remain in understanding responses; optional `persistedTaskId`/`batchId` link them to durable records. Old message + intentResult Journey creation remains compatible, but **only** a server-issued receipt can reuse Live results. Receipt expiry does not erase a task. Task-based creation rechecks owner/account/Knowledge version and reserves the same Journey ID; it never treats old facts as a permanent eligibility decision. Use `/tasks` after re-login, since a new session should not impersonate the old session ID.

Draft updates bind both draft version and current Journey version. Correction/document changes make an old draft stale; the user must review before saving again. Preview/confirm and download remain separate, no insurer submission or CRM integration is fabricated. Cascade deletion removes linked document metadata, notes, previews, confirmations, events and task links, updates affected batches, and removes linked conversation task facts/replies while preserving independent tasks.

## Errors

| Code | HTTP / behavior |
| --- | --- |
| `AUTH_REQUIRED`, `SESSION_EXPIRED` | 401; sign in again, no automatic model resend |
| `EMAIL_NOT_VERIFIED` | 403; finish verification |
| `ORIGIN_NOT_ALLOWED`, `ADMIN_REQUIRED` | 403 |
| `JOURNEY_NOT_FOUND`, `TASK_NOT_FOUND` | 404 without existence disclosure |
| `JOURNEY_STALE`, `TASK_STALE`, `JOURNEY_BUSY`, `IDEMPOTENCY_CONFLICT`, `CONVERSATION_INCOMPLETE` | 409; reload/review; no silent overwrite or generation replay |
| `VALIDATION_ERROR`, `AUTH_TOKEN_INVALID` | 400 |
| `AI_BUSY`, rate/quota errors | 429 with actionable existing UI messages |
| `STORAGE_UNAVAILABLE`, `MAIL_UNAVAILABLE` | 503, generic sanitized message, never a false success |
| `DATA_INTEGRITY_ERROR` | 503; stop using the affected record |

Existing `AI_TIMEOUT`, `AI_UNAVAILABLE`, `AI_USAGE_UNAVAILABLE`, `AI_DAILY_LIMIT_REACHED`, `JOURNEY_STALE` and file error contracts remain. Product sessions use AUTH/SESSION errors; legacy test routes retain TEST_SESSION codes.

## Backup, restore and deletion

The backup routine streams a consistent snapshot transaction into a private JSONL file containing encrypted records, EJSON metadata and a domain-separated HMAC signature. It returns the actual SHA-256/record count. A restore verifies the signature, authenticates encrypted records, checks schema version and writes only to an **empty dedicated restore database**. It refuses to overwrite an active/populated database. The CLI additionally requires a `navi…_restore_<suffix>` target and `--confirm`. The production account must not be granted broad database rights merely to run a restore; provision a separately scoped restore credential when needed.

`node --env-file=/private/api.env apps/api/src/storage/admin.js backup`

For recovery, use a separate environment selecting the empty restore database, then `node …/storage/admin.js restore <private-backup.jsonl> --confirm`. Validate `/ready`, ownership and a recovery test before changing the runtime database name. Keep the original source database and previous release until verification succeeds.

Backups rotate after seven days. Online deletion removes live owner data; it does not instantly destroy offline backups. Restores must honor any deletions since the snapshot before reopening access. Keep the encryption key separately protected; lost keys cannot be recovered from a backup. No raw medical or bank upload is permanently stored. This does not establish legal approval to process real sensitive data through Google's unpaid service.

## Tests and A migration

Use an official local MongoDB community binary with a replica set. `MONGOD_BINARY=/path/to/mongod npm test` and `npm run test:product` start only isolated loopback test servers in ignored `artifacts/`; an external/Atlas test URI is rejected. The runner uses an ephemeral port, never modifies an existing local server, and stops only its own child. Driver transport is real; Gemini and email transports are mocked. `/demo` remains browser-local.

A can now: initialize `/session`; show login/verification/consent; load paginated `/journeys` and `/tasks`; select saved tasks with the task-based POST; restore a selected Journey; keep draft and Journey versions; handle 409 by reloading rather than overwriting; and clear all tabs' local display state when identity changes. The necessary minimal controls are integrated without replacing A's chat/Guided Action layout. API/private secrets stay out of Vite/Next public variables.

Before production: provide Atlas SRV/database/least-privilege credentials and network allowlist; provide authorized SMTP/from address; verify email delivery and A3 Browser E2E; check the Atlas free/paid plan without enabling billing; migrate/backup existing persistent data if any; build a fixed SHA off-VPS; switch with an environment snapshot and rollback. No Atlas credentials or SMTP were configured by the implementation, so local success must not be reported as production persistence.

References: [MongoDB Node transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/), [Atlas database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/), [Nodemailer SMTP/TLS](https://nodemailer.com/smtp).

Before a coordinated switch, stop only the NAVI API, wait for in-flight generations to finish, and run `storage/admin.js import-usage` with the configured legacy `AI_USAGE_FILE`. This imports the recorded day/count once in a MongoDB transaction, adds it to any existing counter and preserves active provider backoff. Repeating the command does not reset or double-charge usage. It rejects an unsafe path, malformed record, future day or active lease. Then restart the new release. No API generation is made by this migration.

Conversation responses may include optional `correctionRequired:true`. A vague correction with no target does not mutate all same-service tasks or establish a new Journey. Show its clarification text and let the user select the existing Journey's correction action. Independent same-service tasks retain separate persistent IDs; the model context keeps a bounded recent window, while the account task list remains the durable recovery source.
