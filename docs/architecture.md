# NAVI — 目前架構（Developer B Phase 4A Review）

**AI interprets. The system decides.** NAVI is a service navigation layer, not an insurer's eligibility or claim submission system. The mock insurance website is a separate application.

## Implemented backend

```mermaid
flowchart TD
  HTTP[Express API: bounded inputs / CORS / rate limit] --> Intent[Intent service]
  HTTP --> Journey[JourneyService]
  HTTP --> Knowledge[Local snapshot / prototype retrieval]
  Intent --> AI[AIProvider: Demo default / explicit Live]
  Journey --> Documents[File signature / MIME / size validation]
  Documents --> AI
  Knowledge --> AI
  AI --> Demo[Offline scripted Demo]
  AI --> Guard[Free Tier attestation / CI block / 12-attempt budget]
  Guard --> Gemini[Gemini Developer API: approved model only]
  Gemini --> Schema[Structured JSON + Zod + normalization]
  Demo --> Schema
  Schema --> Facts[Interpreted facts only]
  Facts --> Validation[Evidence validation + cross-document / incident consistency]
  Validation --> Rules[Deterministic workflow / readiness / next action]
  Journey --> Rules
  Rules --> Repo[Injected InMemoryJourneyRepository]
  Knowledge --> Grounding[Verify extractive answer + retrieved source IDs]
  Grounding --> Answer[Source-labeled answer / explicit template fallback]
```

`apps/api/src/services/gemini.service.js` implements the provider interface with native fetch, not a Google SDK imported into controllers. `ai/prompts/` holds separate system instructions. `ai/schemas.js` validates model-only outputs; `shared/intelligence.js` and `shared/journey.js` define public contracts. The model cannot supply scores, workflow stages or actions. Missing facts remain null.

Demo is the default; ordinary dev scripts force Demo. Live requires an explicit command and `GEMINI_FREE_TIER_CONFIRMED=true` after a human verifies the project has no Billing. The tool cannot verify billing from an API Key. CI cannot call live AI. All attempts, including retries, share a hard 12-request budget per provider/process; no automatic reset or paid fallback. 429 backs off once, then stops live evaluation. Quota/guard failures are not hidden by wording fallbacks.

The only approved live model is `gemini-3.5-flash-lite`, configured centrally. A single 10-second deadline covers at most two attempts. Live intent/document failures return safe API errors and leave the stored Journey unchanged. Only non-critical knowledge/handoff wording can use the actual retrieved/known-fact template, explicitly labeled.

目前展示住院醫療理賠：事件 20 + 服務 15 + 診斷書／住院證明 20 + 完整住院資訊 15 + 匯款示範存摺 20 + 確認 10，成功路徑 **35 → 70 → 90 → 100**。權重與院所規則在 `shared/hospitalization.js`；條件性文件 required=false、weight=0。缺欄位／低信心／文件矛盾需人工確認，移除文件撤回分數及確認。Legacy 班機仍保留原權重供 API／測試使用。100% 僅代表原型資料準備完成，不代表保障適用、核准、送件或核付。

Only extracted fields and bounded server Journey records are stored in memory; file bytes are request-scoped. Repository TTL/capacity and rate limits remain process-local. There is no database, authentication, durable storage, insurer submission or specialist connection.

## 目前前後端整合邊界

```mermaid
flowchart TD
  Host[Next.js 模擬官網 3000] --> Embed[NAVI iframe 5173/embed?mode=demo]
  Embed --> Mock[本地 Mock Adapter]
  Landing[一般 NAVI 5173] --> IntentAPI[POST /api/intelligence/understand]
  IntentAPI --> Provider[Backend Demo / 明確啟用的 Live]
  Provider --> Local[瀏覽器 Journey / Mock 文件]
  Mock --> Local
  Local --> LocalKB[本地官網 seed 搜尋]
  LocalKB --> Bridge[可信目的地 / 精確 origin + window]
  Bridge --> Host
  Backend[既有 server-owned Journey / 文件 / Knowledge APIs] -. 尚未接入 A 工作區 .-> Local
```

一般入口目前只有 Intent 使用 API；`/demo`／`/embed?mode=demo` 完全本地。A 的工作區、文件、知識搜尋、確認與持久性仍由瀏覽器 Adapter 處理。文件套用 fixture，不讀取真實文件；Live Intent 不代表整個 UI 已使用真實文件 AI。

Backend main 已有住院 server Journey、診斷書／住院證明、存摺與交叉驗證，來自先前 `c8d00fe`，**不能據此宣稱重新規劃的 Phase 4B 已完成**。Phase 4A 僅做 Review、小幅 API 相容性修正及跨實作成功路徑測試；4B 仍需住院專用驗收、負向案例與 A 的 server adapter，4C 仍需 Knowledge／Navigation 對齊。詳見 [Phase 4A Review 與規劃](backend-phase-4a.md)。

## Repository layout / independent sites

- `apps/web`：React/Vite NAVI，`127.0.0.1:5173`；dev `/api` proxy 到 3001。
- `apps/api`：Express NAVI API，`127.0.0.1:3001`；Key 僅限 ignored 本機 `.env`。
- `apps/mock-site`：獨立 Next.js 模擬保險官網，`127.0.0.1:3000`；自有 routing／assets／styles，使用原 `data/`、`lib/contracts/`。
- `shared/`：NAVI Zod 契約、住院規則、可信導航；原模擬官網契約仍另外保留。
- `knowledge/`：本地官網 snapshot retrieval 與合成示範文件；Legacy 資料仍標示 prototype。

`npm run dev:all` 啟動三個獨立程序。設定 README 的雙站嵌入環境值後，模擬官網顯示 NAVI iframe；「帶我去」透過已驗證訊息切換模擬站頁面、分頁、捲動及高亮。未設定時仍可用獨立 `/demo`。不抓取官方站，不跨站傳醫療文件，不連接保險核心或提交理賠。

原 `SPEC.md` 為團隊需求；不可把規劃能力視為已實作。單分頁 sessionStorage 是 A 的狀態；Backend InMemory 是另一份獨立狀態，尚未持久整合。

## 能力與驗收狀態

| 能力 | 真實狀態 |
| --- | --- |
| 嵌入式 NAVI、住院 UI、官網導航 | A 已合併 main；保留 UI／動畫 |
| 一般入口 structured Intent | API 已接入；預設開發 Demo，Live 需明確零成本確認 |
| Server Journey／workflow／scoring／nextAction | 既有 flight + hospitalization 實作；A 工作區尚未採用 |
| PDF／PNG／JPEG／WebP 文件抽取 | Backend 支援；住院只驗證合成／注入 transport，未跑住院真實 Gemini |
| 文件缺欄位／矛盾驗證 | Backend 既有 needs_review／人工確認；前端 Mock 行為未完全對齊 |
| 本地官網 Knowledge／來源／目的地 | 前後端皆已有，回應型別與部分服務欄位尚待 4C 對齊 |
| AI handoff wording | 既有可選 known-fact selection；沒有實際專員連線 |
| Phase 4A | Review／相容性／回歸驗證，見專用報告 |
| Phase 4B／4C | 尚未開始；現有程式不等於新階段驗收 |
| RAG／Vector DB／MongoDB／Auth／Multi-Agent | 未實作 |

歷史 [Backend AI Phase 2](backend-ai-phase-2.md) 的真實 Gemini 成功紀錄僅屬當時班機情境，不是住院 Live 測試。本次 Phase 4A 沒有呼叫 Gemini。phase-2a／Backend Demo Phase 1 保留為歷史報告；最新差距與計畫以 Phase 4A 報告為準。

## Phase 3 evaluation boundary

`apps/api/eval/cases.jsonl` contains 120 authored synthetic cases: intent 30, document 20, consistency 30, knowledge 20, security/business-boundary 20. Local evaluation uses Demo/fixtures and tests deterministic behavior; stored adversarial outputs do not prove live prompt-injection resistance. The fixed Live manifest selects 5 intent + 2 PDF + 2 knowledge samples, maximum 12 outbound attempts including retries.

Evaluation-only filesystem caching hashes model, version, prompt, input and schema. Raw responses are schema-validated again on replay; grounding and expected facts are independently checked. Cache hits are not fresh live samples. `--refresh` skips cache without bypassing the budget. Production uploads never use this cache. Local evaluation / test / build / status / plan make no Gemini requests. Unit tests allow only mock transport and loopback fetch.

Phase 4A 沒有新增 runtime dependency 或 hosted service；住院專用 eval corpus 尚待 4B，舊 120 題與固定 Live manifest 不代表住院模型準確率。 No Search/Maps tools, Batch, Vertex, paid Context Caching, paid model fallback, OCR or external storage path exists. All provider account checks remain manual; free-tier quotas and availability can change. Current Phase 3 has no fresh Live results, deliberately preserving the zero-cost boundary. See [Phase 3 operation and evaluation](backend-ai-phase-3.md).
