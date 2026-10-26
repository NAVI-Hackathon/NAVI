# Pending genuine AI evaluation — no requests executed

Offline dataset: `apps/api/eval/reliability/cases.jsonl` (27 fixed cases). `npm run eval:reliability:local` injects authored responses through the Gemini REST transport and validates JSON, guards and service disposition. Its pass rate is **not model intent accuracy**. Every row retains ground truth, actual normalized output, mock latency, request count and fallback status.

## Minimum proposed Live budget (requires separate approval)

At most **5 actual generations**, with no retries, stop on the first error/timeout:

1. Hospitalization: `合成測試：我在 NAVI TEST HOSPITAL 住院五天，想知道怎麼申請理賠。`
2. Negated hospitalization: `我其實不是住院，是門診，要準備哪些文件？`
3. Multiple intents: `我想改地址，也想知道要怎麼申請住院理賠。`
4. Unknown: `我有一點事情想處理，但還不知道是哪一種。`
5. One synthetic PDF from the fixed fixtures; assert the actual bytes reach Gemini, then inspect extracted facts and backend validation. A file marked NOT VALID may legitimately need review.

The first and third cases also distinguish claims from address changes. No photos/PDFs containing real people, medical or banking data. Extended blurred/injection/multi-page vision evaluation remains unmeasured, not implicitly passed by mocks.

Before execution: user verifies the same AI Studio project's current Free Tier, model `gemini-3.1-flash-lite` availability and remaining project quota; inspect the server's private Pacific-day ledger and reserve this budget within the existing 20/day cap. `GEMINI_FREE_TIER_CONFIRMED=true` is a configuration gate, not current billing evidence. No billing/model changes, Search Grounding, Vertex or paid fallback.

Use the existing provider and request budget, attempts=1 and one concurrent generation. Log only synthetic case ID, model/provider, UTC timestamp, ground truth, cleaned structured output, pass/fail, latency, timeout, request usage and fallback. Do not log API keys, cookies or operator tokens. Live/Mock reports are separate; do not combine their denominators. Five cases cannot justify a population accuracy claim.

Current audit status: **not run; 0 Live generation requests**. A genuine-AI success claim for this new multi-task prompt must wait for these results. Existing deployment remains synthetic-only; no public real personal document intake.

Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms) prohibit submitting personal/sensitive information to unpaid services and describe potential use of unpaid inputs/outputs for product improvement. Current project rate limits must be checked in [AI Studio](https://aistudio.google.com/) as described by [Google's rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits); generic model listings do not establish remaining project quota.
