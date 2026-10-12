# AfterZeroHackathon · NAVI 與 Mock Website

此 Repository 包含兩個獨立網站：**NAVI 黑客松主產品**，以及 **Demo 用模擬保險官網**。兩者有各自的 routing、CSS、framework、build 與執行程序；不把模擬頁面嵌進 NAVI。

NAVI — AI Service Journey Navigator · Understand. Guide. Resolve.

## Project Structure

```text
apps/
  web/                 NAVI：React / Vite，Premium UI、工作區、Golden Path
  api/                 NAVI：Express / Gemini、server-owned Journey 與文件辨識 API
  mock-site/           Mock Website：Next.js / TypeScript / Tailwind
    app/(site)/        模擬官網、常見問題與服務分頁
    components/site/   模擬站導覽、Tabs、data-tour-id、示意下載
    components/navi/   浮動 NAVI iframe、跨頁導覽與目標高亮
    public/            原有靜態資產
shared/               NAVI Intent / Journey / 文件 / 嵌入訊息共用 Zod 契約
lib/contracts/         原模擬服務助手契約（保留，未改成 NAVI 契約）
lib/db/、lib/env.ts     原團隊的資料庫／環境規格骨架，尚未接入現有服務
data/                  模擬官網本地 seed、爬蟲輸出
knowledge/             NAVI 示範文件、FAQ、來源、準備度規則
scripts/               啟動、雙站驗證、原有爬蟲
docs/                 架構、展示、QA 與整合紀錄
```

所有安裝共用 root `package-lock.json`；Node.js **22.12+**。請在 repository 根目錄安裝，不要為每個網站另建 lock file。

## Run NAVI

在根目錄：

```sh
npm install
# 首次設定：檔案已存在時勿覆蓋
cp apps/api/.env.example apps/api/.env
# 預設 Demo 不需要 API Key；Live 設定見 Zero-Cost Architecture
npm run dev:navi
```

主產品 URL：**http://127.0.0.1:5173/**。Backend：http://127.0.0.1:3001/api/health。
`npm run dev` 仍是原本 NAVI 的啟動捷徑；`dev:web`、`dev:api` 可分別啟動。整合啟動的 API 不監看檔案，修改 Backend 或 `.env` 後請重新啟動；`dev:api` 則保留開發監看。

**Developer B Phase 2 已完成 Backend AI 整合；Phase 3 已加入零成本防護與本地評估**。`dev`／`dev:navi`／`dev:all`／`dev:api` 一律以 Demo 啟動，不受舊 `.env` 的 `AI_MODE=live` 影響，也不送出 Gemini 請求。Free Tier 設定確認後，需人工執行 `npm run dev:live` 才啟用真實 Intent、文件抽取、JSON grounded knowledge 與 server-owned Journey。Live 失敗不會偷偷轉 Demo。

**目前住院工作區仍使用 Mock 文件與瀏覽器 workflow**；一般模式的入口 Intent 使用 Backend API，依明確啟動模式區分 Demo／Live；`/demo` 則完全使用本地 Mock Adapter。Backend 已支援住院 server-owned Journey、診斷書／住院證明、存摺抽取與交叉驗證；A 的工作區尚未接入這些 API。本次只使用注入 transport 與合成文件測試，沒有真實 Gemini 請求。[住院 Backend 與 PR Review](docs/backend-hospitalization.md)記錄最新契約與限制；[歷史 Backend Phase 2](docs/backend-ai-phase-2.md)保留班機延誤整合紀錄。

Backend 設定集中於 `apps/api/src/config/env.js`，範例在 `apps/api/.env.example`；預設 `gemini-3.5-flash-lite` / minimal thinking，整體 AI deadline 10 秒。`.env` 只在本機，不能 commit。Live 未設定 Key 或未確認 Free Tier 時不允許外部請求；Demo 不需要 Key。health 的配置欄位僅表示 Key 存在，不代表供應商連線成功或 Billing 狀態。

前端設定在 `apps/web/.env.example`；`/api` 由 Vite proxy 連到 3001，production 需部署同 origin reverse proxy 或設定 `VITE_API_BASE_URL`。Key 不可放進 `VITE_*`。

## Run Mock Website

在根目錄：

```sh
npm install
npm run dev:mock
```

或安裝完成後：

```sh
cd apps/mock-site
npm run dev
```

URL：**http://127.0.0.1:3000/**。這是展示外部服務情境的模擬保險官網，**不是 NAVI**。
固定綁定 127.0.0.1:3000；不與 NAVI 共用 router 或 API。沒有登入、保險送件、OpenAI 或 Turso runtime，不需要填 root `.env.example` 才能啟動。

保留首頁、服務總覽、表單下載、保單變更、借款、理賠程序、網路服務、名詞解釋，以及 hash 分頁、`revealTabPanels`、`data-tour-id`。內容讀 root `data/cardif_seed_data.json`，共用型別讀 `lib/contracts`；專用 tsconfig aliases 與 Next workspace root 已設定。原有示意 QR、下載說明和非官方標示保留；沒有對官方網站的 runtime fetch／iframe／盜連。

## Run Both

```sh
npm install
npm run dev:all
```

| 執行程序 | URL | 用途 |
| --- | --- | --- |
| NAVI Web | http://127.0.0.1:5173/ | 主產品 |
| NAVI API | http://127.0.0.1:3001/api/health | 意圖分析 Backend |
| Mock Website | http://127.0.0.1:3000/ | 模擬外部服務 |

`Ctrl+C` 一併停止三個程序；任一程序啟動失敗會停止其他程序。連接埠被占用時會報錯，不會自動換到另一個 port。不要同時再跑 `dev:navi`／`dev:mock`。

### 啟用嵌入式 NAVI 與官網導覽

嵌入功能已實作，預設未設定網址，因此模擬網站不會顯示浮動按鈕。若要展示，請將以下設定加入各自的本機檔案（保留已有設定，不要覆蓋，也不要 commit）：

`apps/web/.env.local`：

```dotenv
VITE_EMBED_ALLOWED_ORIGINS=http://127.0.0.1:3000
VITE_MOCK_SITE_URL=http://127.0.0.1:3000
```

`apps/mock-site/.env.local`：

```dotenv
NEXT_PUBLIC_NAVI_EMBED_URL=http://127.0.0.1:5173/embed?mode=demo
```

重新啟動 `npm run dev:all` 後，在 **http://127.0.0.1:3000/** 點右下角 NAVI，便會開啟獨立 NAVI 網站的 iframe。上述 `mode=demo` 使用本地 Mock Adapter，不呼叫 Backend 或 Gemini。「帶我去」會讓模擬網站切換頁面／分頁、捲動並高亮目標；手機版導覽後會收合助手。獨立 NAVI 的相同動作則開啟模擬網站新分頁。

兩站仍各自執行，沒有把模擬官網 routing 搬進 NAVI，也沒有自動讀取官網內容或跨站傳遞案件資料。訊息同時驗證精確 origin、預期 window 與 Zod Schema；請統一使用 `127.0.0.1`，不要與 `localhost` 混用。未啟用嵌入時，可直接在 **http://127.0.0.1:5173/demo** 展示完整本地流程。

## Demo Flow

1. 開 **3000** 模擬網站 →「理賠程序介紹」(`/services/claims`) → 切換「應備文件」，展示使用者原本需要自行搜尋／閱讀的情境。
2. 啟用上述嵌入設定後，點右下角 **NAVI** 開啟助手；未設定時，手動切換至 **http://127.0.0.1:5173/demo**。一般模式 **http://127.0.0.1:5173/** 的入口會呼叫 Backend Intent API，與本地示範模式不同。
3. NAVI 輸入「我上週在台中榮總住院五天，要怎麼申請理賠？」→ 開始分析 → 住院醫療理賠旅程 **35%**（辨識臺中榮民總醫院為醫起通合作醫院）。
4. 上傳診斷書或住院證明（Mock 辨識）→ **70%**；上傳存摺影本（Mock）→ **90%**；確認資料並確認已填妥保險金申請書 → **100%**。各步驟可點「帶我去」查看應備文件、匯款規定與表單位置；前往服務先開啟導引預覽，再可導航至模擬服務入口，不送件。
5. NAVI 右上選單「重新開始示範」可清除本分頁進度。reload 保留 sessionStorage；不同 tab 的案件分開。

住院理賠的應備文件、醫起通合作醫院、理賠聯盟鏈與郵寄規則全部取自 `data/cardif_seed_data.json`（官網公開資料整理）；診斷書與存摺內容為示範資料。一般模式搭配預設開發指令時由 Backend Demo Provider 回應，API metadata 標記 `demo_fallback`；`/demo` 與 `/embed?mode=demo` 不依賴 API。要使用真實 Gemini 入口理解，需先確認下方零成本條件，再人工執行 `npm run dev:live`。若要演示 Backend 斷線時的前端備援，請先按下方方式**明確啟用示範備援**；備援畫面會標記本次未使用 AI。

## 測試與 Build

執行 Mock Website build／typecheck 前，先停止其 dev 程序；避免 Next 產生的型別與開發程序同時更新。

```sh
npm test                  # Frontend + Backend，完全不需要 API Key
npm run test:web
npm run test:api
npm run build             # NAVI Frontend production build
npm run build:mock        # Mock Website production build
npm run build:all         # 兩站各自 build
npm run lint              # Mock Website 既有 ESLint
npm run typecheck:mock    # Mock Website TypeScript
npm run test:sites        # 先啟動 dev:all；雙站路由、資產、API proxy smoke checks
npm run preview           # 只預覽 build，不會自動提供 API；需另啟 API / 設定部署 proxy
npm run eval:ai:local     # 預設：120 個合成 fixture / deterministic cases，零 Gemini 請求
npm run eval:ai:live -- --plan # 只顯示 9 個案例計畫，零請求
npm run eval:ai:live      # 人工確認 Free Tier 後才可執行，含 retry 最多 12 次
npm run ai:status        # 本地配置檢查，不驗證帳戶或呼叫 Gemini
npm run test:integration  # 相容舊指令：現在執行 Local evaluation
npm run test:ai           # 相容舊指令：現在執行 Local evaluation
```

一般測試使用注入的 Mock Provider，驗證中英班機延誤、車禍、信用卡扣款變更、Unknown、驗證／錯誤／超時／CORS／rate limit 與原有 Golden Path。**Mock Provider 測試不代表模型實際理解能力已驗證。** `npm test` 加入外網 fetch 防護，只允許 loopback HTTP 與注入 Mock。Live sample 需明確執行、顯示計畫與上限；不輸出 key 或完整使用者內容。

歷史 Developer B Phase 2 QA（不是本次 Phase 3 Live 結果）：Frontend 10/10、Backend 52/52；真實 Gemini 5 項 Intent 及完整 API Golden Path / grounded knowledge 已通過。測試文件為程式建立的 synthetic PDF，不是實際旅客資料；完整紀錄與已知限制見 [Backend AI Phase 2](docs/backend-ai-phase-2.md)。

## Golden Path

輸入「我上週在台中榮總住院五天，要怎麼申請理賠？」→ 意圖理解（Gemini 或示範判讀）→ 住院醫療理賠工作區 **35%**（事件資訊 20 + 服務辨識 15）→ 診斷書或住院證明 **70%**（文件 20 + 住院資訊完整 15，住院 5 天）→ 存摺影本 **90%**（匯款給付 20）→ 確認資料並填妥保險金申請書 **100%**（10）→ 依醫院選擇管道：醫起通（合作醫院）、理賠聯盟鏈或郵寄，並提醒醫起通仍需開立診斷書、聯盟鏈 10 日內寄回正本、單次超過新台幣 30 萬元需等正本寄達。

目前前端住院旅程仍由本地 Adapter 計算；Backend `POST /api/journeys` 已可建立 `hospitalization_claim` 的 server-owned Journey（35%），上傳診斷書／住院證明（70%）與存摺（90%），再確認（100%）。Backend 權重與院所／管道資料集中於 `shared/hospitalization.js`，與 A 現有成功路徑一致；A 接入時應直接渲染 API Journey，移除重複計算。班機延誤僅保留 Legacy API／測試，不是法國巴黎人壽展示服務。

文件齊備時為 `READY_FOR_REVIEW`／90%；確認後為 `READY_TO_PROCEED`／100%。100% 只代表資料完整，不判斷保障、理賠資格、核准或送出申請。移除／替換文件會撤回分數與確認。目前 UI 文件不會讀取或上傳；只有明確啟用 Live 並通過 Free Tier guard 時，自然語言描述才會送到 Gemini。使用 Live Backend 文件 API 時，文件 bytes 會在本次 request 傳送至 Gemini；Demo 只讀指定 fixture，Repository 不儲存 bytes。

Frontend 與 Backend 都依本地 `data/cardif_seed_data.json` 提供服務知識。Backend 已支援住院應備文件、地址變更、受益人表單、保單借款、密碼鎖定與官網服務入口；`public_site_snapshot` 來源附 ID、原始 URL、整理日期及可信導覽目標。Legacy 班機資料仍標明 prototype。找不到可靠內容或涉及投保建議、理賠核定、資格／金額判斷時回傳資訊不足與空來源，不呼叫 Gemini 補猜。

其他已辨識需求只顯示「目前 Prototype 尚未開放完整服務旅程」，不展示假的完整 Workflow。模糊需求顯示「我還需要一些資訊」；低信心已知需求進入專員確認。真人接續僅準備本機摘要，不會聯絡專員。

## 明確示範備援

如需 API 故障時仍能展示 Golden Path，可自行複製 `apps/web/.env.example` 為 `.env.local`，設定：

```dotenv
VITE_ENABLE_DEMO_FALLBACK=true
```

重新啟動 Web（或重新 Build）後生效。只有 API failure 時且只支援住院醫療理賠；畫面會顯示 **「示範備援判讀 · 本次未使用 AI 分析」**。有效的 Unknown／低信心結果不會被替換。預設與 production 都為關閉，Backend 的明確 `AI_MODE=demo` 是另一種示範方式；不會因 live 失敗而自動切換。

## API 與架構

- `GET /api/health`：狀態與 AI provider 是否已配置，不暴露環境值或密鑰。
- `POST /api/intelligence/understand`：相容既有前端的 Intent envelope。
- `POST /api/analyze-intent`、`POST /api/journeys`、`GET /api/journeys/:id`：辨識／建立／取得案件。
- `POST /api/journeys/:id/documents`：Multipart 真實文件抽取；DELETE 同路徑加 document ID 可移除。
- `POST /api/journeys/:id/review`：`{ "confirmed": true }`，Backend 決定是否可以確認。
- `GET /api/knowledge?query=...`：保留舊 JSON retrieval；`POST /api/knowledge/answer` 接 grounded AI，body 為 `{ "question": "..." }`。
- `GET /api/journeys/:id/handoff-summary`：deterministic 摘要；`?enhance=true` 可加選取已知事實的 AI 摘要。

```text
apps/web/src/            Premium React UI、純 workflow、API client 與 tests
apps/api/src/            Express、providers / prompts / validation / workflow / repository / knowledge
apps/api/test/           Mock Provider contract / transport / zero-cost tests
shared/intelligence.js  共用 Zod schema、enums、mapping 與 threshold default
scripts/dev.js          無額外依賴的 NAVI／雙站開發啟動
knowledge/              Mock 文件、FAQ、來源與既有準備度規則
docs/                   架構、產品、展示與各階段 QA 記錄
```

Premium Dark UI、繁中／英文輔助、CSS Motion System、Reduced Motion、桌面三欄、手機 Tabs、來源面板與 Demo Reset 全部保留。既有進度仍使用同分頁 `sessionStorage`，reload 保留 validated AI facts 與 mock documents；不儲存文件位元組。

詳見 [真實架構](docs/architecture.md)、[展示腳本](docs/demo-script.md) 與 [Phase 2A 報告](docs/phase-2a-report.md)。歷史 Phase 2A 文件保留；AI 契約以 [Developer B Phase 2](docs/backend-ai-phase-2.md) 為準，最新啟動、成本防護與評估以 [Phase 3](docs/backend-ai-phase-3.md) 為準。RAG / Vector DB / MongoDB / Auth / Multi-Agent 未實作。


## 整合與協作

`3a09337` 的模擬官網成果已合併，NAVI 與 Mock Website 以 npm workspaces 分開。根目錄 Next.js 起始設定搬到 `apps/mock-site`，不再干擾 NAVI。兩種助手契約用途不同，沒有強行合併；原 `SPEC.md`／`AGENTS.md` 保留作為團隊規格紀錄，現有可執行入口以本 README 為準。完整差異與驗證見 [整合報告](docs/repository-integration.md)。

## Zero-Cost Architecture

NAVI prototype is intentionally designed to run using free-tier and local components only, **subject to provider free-tier availability and quotas**.

- Gemini Developer API `gemini-3.5-flash-lite` Free Tier，minimal thinking；僅限未啟用 Billing 的專案。
- Demo Provider、Local JSON Knowledge Base、InMemory state、本地 synthetic fixtures，不需要外部服務。
- 無 paid search / Maps grounding、paid vector DB、paid OCR、付費儲存、Batch、付費 Context Caching、Vertex AI 或其他付費 AI fallback。
- `ALLOW_PAID_AI=false`；設為 true 直接拒絕配置，不能啟用付費能力。
- `CI=true` 時禁止 Live，unit tests 另阻擋外網 fetch；不新增 GitHub Actions 或雲端部署依賴。

**API Key 無法證明帳戶是 Free Tier。** 工具不會查帳戶、啟用 Billing 或建立雲端資源。Live 前需自行在 AI Studio 確認 Key 所屬專案為 Free Tier、未啟用 Billing；只有確認後才在本機 `apps/api/.env` 設定：

```dotenv
AI_MODE=live
GEMINI_API_KEY=<backend-only key>
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FREE_TIER_CONFIRMED=true
ALLOW_PAID_AI=false
LIVE_AI_REQUEST_LIMIT=12
```

```sh
npm run ai:status              # 不發請求；billingVerifiedByTool 永遠 false
npm run eval:ai:live -- --plan # 不發請求；固定 5 Intent + 2 文件 + 2 Knowledge
npm run eval:ai:live           # 最多 12 次，所有 retry 共用 budget
npm run eval:ai:live -- --refresh # 明確略過本地 cache；仍受同一上限
npm run dev:live               # 人工啟動 Live NAVI；每個 API process 也最多 12 次
```

`npm run eval:ai`／`eval:ai:local`／`test:ai`／`test:integration` 預設全部 Local。Live 使用固定 9 個合成案例，不會跑完整 120-case dataset；未確認 Free Tier 時直接阻擋。`MAX_LIVE_EVAL_REQUESTS_PER_RUN` 可作為 limit 的別名，`LIVE_AI_REQUEST_LIMIT` 優先；程式不會自動增加上限或重設 budget。API process 的 budget 涵蓋所有使用者與功能，只有人工重啟才重置。

本地 `apps/api/eval/cache/` 只用於 curated synthetic evaluation，不用於使用者文件。Key 包含 model、prompt version、實際 prompt、input 與 schema，schema 合法的 raw response 才會寫入；重讀仍驗證，來源與預期結果仍需通過下游檢查。Cache／reports 不進 Git。429 最多等待 1 秒後 retry 一次；仍失敗即 `AI_RATE_LIMITED`，停止該 Live evaluation，不改用付費 Provider。

Phase 3 本地結果：120/120 合成案例通過，Golden Path 35→70→90→100；**本次未執行 Live Gemini，新增 Gemini 請求 0 次**。Local fixtures 與 cached replay 均不計為本次模型能力驗證；Live 僅報小樣本 passed count 與 fresh-call p50/p95，不宣稱完整 AI accuracy。詳見 [零成本評估文件](docs/backend-ai-phase-3.md)。

Free Tier 價格與配額由供應商決定，請核對 [Google pricing](https://ai.google.dev/gemini-api/docs/pricing)、[billing](https://ai.google.dev/gemini-api/docs/billing) 與 [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)。若不能確認零成本，使用 Demo／Local；程式中的人工確認 flag 不是帳戶帳務驗證，也無法阻止帳戶日後被他人啟用 Billing。
