# Enterprise integration and evidence limits

This is an integration checklist, not a claim that enterprise readiness or user benefit has been measured. P0 offline gates take priority; no P1 feature implementation or real customer study was added.

## Reusable core / required adapters

| Reusable | Enterprise-specific dependency / authorization |
|---|---|
| Gemini provider interface, strict structured outputs | Approved provider contract, billing cap, data residency/processing terms, model validation; free prototype processing is not suitable for real medical/bank data |
| Shared local Knowledge engine and verified excerpts | Official content owner, source inventory, review/release governance, refresh SLA; current data is a dated public-site snapshot |
| Intent/service mapping and deterministic workflow/readiness | Insurer-approved service definitions; scores measure preparation only, never coverage or adjudication |
| Canonical Navigation Plan generator | Authorized website router/DOM adapter, stable target IDs, deployed-target manifest, explicit parent/iframe origins and CSP; current tests cover our mock site only |
| Redacted handoff preview/confirmation | Authenticated CRM/customer-service API, scoped authorization, genuine recipient consent/delivery receipts; current confirmation sends nothing |
| Document extraction/consistency interface | Authenticated customer/case ownership, legal basis, malware scanning/full media decoding, encrypted storage if needed, audited retention/deletion, PII-safe monitoring |
| Usage guards | Durable shared quota for multi-instance deployment; current atomic local filesystem is single-VPS only |

Website owner permissions: add stable DOM targets or approve an alternative locator adapter; allow the NAVI iframe from exact approved origins; authorize routes, redirects and login-bound actions; provide test accounts and staging APIs. Do not automate the real insurer's internal systems without authorization.

Current APIs needed by A: `/api/intelligence/tasks`, existing understanding/journeys/documents/review/explanation/manual information, correction, knowledge/evidence/version, navigation plans and redacted handoff preview/confirm. Migration notes are in `ai-reliability-integration.md`.

## User measurement protocol (no participant data yet)

Record synthetic task ID, anonymous participant ID, condition (site-alone/NAVI), predefined completion criterion, success, elapsed seconds, action count, wrong-target count, API requests/errors. Never record real case details or account identifiers.

- Task completion = successful attempts / eligible attempts; report denominator and exclusions.
- Completion time = median elapsed seconds for completed attempts, with failed attempts separately reported.
- Operations = mean action count; wrong navigation = observed wrong-target events, not inferred from API success.
- API error rate = non-success requests / total requests; distinguish intentional fault injection from normal runs.
- Compare identical tasks with balanced order; report sample size and uncertainty. Local load tests are not user studies.

**Observed participants: 0.** Completion improvement, time saved, reduced calls/returns and revenue effects are not measured. No improvement percentage is asserted.

## Cost model (assumptions, not a quote)

Prototype configuration observed at audit start: daily cap 20 generations, per Session 6 AI operations, one concurrent generation, one attempt. A typical intent + two document flow needs three generations if a trusted intent receipt avoids duplicate inference; multi-task interpretation can reuse selected receipts too. At 20/day, the arithmetic ceiling is six complete three-generation flows with two calls left, **only if all calls succeed and no other feature consumes quota**. This is not Google's guaranteed project quota or production capacity.

Formula for a future approved enterprise deployment:

`monthly total = (intent calls × intent unit cost) + (document calls × document unit cost) + approved infrastructure/storage + review hours × loaded hourly rate + integration/security/support effort`.

- Current new paid API calls/dependencies: 0. No billing changes made.
- VPS and domain already purchased by the user; invoice amounts were not supplied, so do not describe the entire deployment as financially free.
- Storage costs depend on approved retention; current prototype does not persist original files and cases expire on restart/TTL.
- Official-content review and integrations consume human time even with local retrieval.
- Unit costs, actual tokens/document sizes, legal/security effort and enterprise SLA remain unknown. Obtain approved quotes and measure representative workloads before estimating savings.

## Remaining release boundaries

No enterprise SSO, durable authenticated case history, multi-instance synchronization, real insurer API submission, real CRM delivery or eligibility decision. Public upload remains synthetic-only; declaring a file synthetic cannot automatically detect all real personal data. Real medical/bank intake requires a different approved data-handling setup and full privacy/security review. Existing file checks are signature/container checks, not full decoding or malware certification.
