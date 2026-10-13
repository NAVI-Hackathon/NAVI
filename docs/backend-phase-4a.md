# Developer B Phase 4A — Backend Review & Alignment

Review 開始：2026-10-12；完成：2026-10-13。範圍：Review、相容性修正、回歸驗證與後續規劃。**Phase 4B、4C 尚未開始，不將既有程式碼或歷史測試視為新階段驗收完成。**

## 同步與範圍

- 工作分支為 `main`；開始時 fetch 並 fast-forward 檢查，基準為 `63845e1`，與 origin/main 相同。
- PR [#2](https://github.com/NAVI-Hackathon/NAVI/pull/2) 已合併；檢查原始差異 `310c27d…1056daa` 與目前 main 的實際呼叫端，而非只看舊 PR。
- `32a6c6a` 已包含 A 的官網知識搜尋；`c8d00fe` 已包含先前的住院 Backend、來源與導航支援。本次重新盤點這些既有能力，不重新實作或宣稱 4B 已完成。
- 已讀 AGENTS、SPEC 的產品／安全／API／導航規範、README 與現有 Backend。原始 Next/OpenAI/Turso 規格保留為團隊紀錄；依 README 維持目前 React/Vite + Express 架構，沒有更換技術棧。
- 不修改 `apps/web`、`apps/mock-site`、`shared`、`AGENTS.md`、seed 資料、環境檔或相依套件。保留使用者原有 `docs/phase-2a-report.md` 未提交修改，排除本次 commit。
- 依使用者明確指示直接提交並推送 main，commit 使用英文；不 force push。

## PR #2 Review

### Critical

本次檢查範圍未發現未處理的 Critical 問題。此結論限單機、合成資料示範，不代表公開醫療資料服務的安全驗收。

### High

| 發現 | 原始 PR／目前狀態 | 處理 |
| --- | --- | --- |
| 手術／門診可能被誤當住院；`medical_claim` 別名過廣 | 原 PR prompt／Demo 分類較寬。目前 Backend 已要求明確住院，否定住院回 Unknown；廣義 medical alias 需摘要提供住院事實 | 既有修正，本次回歸驗證；不再擴大 enum |
| 省略 expectedSource 時可能跳過 source window 驗證 | 目前 `shared/embed.js` 已 fail closed；A host 傳 iframe.contentWindow，NAVI 傳 window.parent，並檢查精確 origin | 既有修正，本次確認呼叫端，不修改契約 |
| 嵌入 Demo 仍會把否定住院分到住院旅程 | 實際重現 `只有門診開刀，沒有住院`：前端 Mock = hospitalization_claim；Backend Demo = unknown | 未修，屬 A；4B 接入時採用共用判斷或 API，需 A 處理 |
| 合作院所前端比對過於寬鬆 | 實際重現 `榮總` 被指定為臺北榮總；`台中榮總不存在分院` 被指定為臺中榮總。Backend 兩者均回 null | 未修，屬 A；可能導向不適用的醫起通入口，需改用保守共用比對 |

### Medium

| 發現 | 狀態與影響 | 處理 |
| --- | --- | --- |
| 原 PR 導航僅格式驗證，未限制真實目標 | 目前由本地 seed/Sitemap 許可 path、anchor、sourceUrl 的組合；不接受 AI 自由 URL 或假來源 | 既有修正，相關拒絕測試通過 |
| 原 PR shared 醫療文件類別與 Gemini／Backend 驗證不同步 | 目前 native JSON Schema 從 Zod 產生；診斷書、住院證明替代、存摺皆有抽取及 needs_review 驗證 | 既有修正；真實住院文件 AI 準確率仍未驗證 |
| Unknown 仍可保留高 confidence | 通用 normalizeIntent 原先接受 unknown + 0.99，只有 Gemini 特定路徑另有限制 | **本次修正**：通用邊界最高 0.4，清除無關 facts，補 HTTP／Journey 回歸測試 |
| 主要 Intent API 缺 provider mode header | `/api/analyze-intent` 有 header，但 A 使用的 `/api/intelligence/understand` 沒有 | **本次修正**：集中於 app 的 `/api` middleware，保留 JSON envelope、meta 和 CORS 暴露設定 |
| Backend Knowledge 未保留部分公開服務欄位 | shared seed parser／Backend content 沒有納入 apply_time、effective_time、online_available，A 搜尋可顯示這些欄位 | 記錄 4C 完整性差距；本次不增加新的保險回答內容 |
| 原 PR 新增測試偏成功分類 | 原始測試不足以涵蓋否定住院、Unknown、來源／導航、文件不足、資料矛盾與 provider 錯誤 | 目前 main 已有對應 Backend 回歸案例；本次新增 4 項跨入口／跨實作檢查，仍缺住院專用 eval corpus |

### Low

- Live budget 停止訊息仍為英文：本次改為繁體中文；error code、狀態碼、不可自動 retry 的規則不變。
- architecture 舊文件仍說「沒有嵌入助手」且只列班機計分：本次更新成實際 main 架構，區分已存在能力、A 尚未接入、歷史 Live 結果與未驗收階段。
- 展示文件與舊評估情境需分流：保留歷史測試／報告，避免把班機資料當成法國巴黎人壽服務。

## Intent / Shared Contract

檢查檔案：`ai/prompts/intentPrompt.js`、`ai/schemas.js`、`ai/demoProvider.js`、`test/hospitalization.test.js`、`shared/intelligence.js`、`shared/journey.js`、`shared/embed.js`，並追蹤 routes、services、A adapter 與 bridge 的呼叫。

- 公開 Intent 保留 `service_request / knowledge_query / unknown`；serviceType 保留舊類型並增加既有 `hospitalization_claim`，未重新命名車禍等舊 enum。
- alias 僅做明確名稱正規化；不認得的類型回 unknown，不靠別名猜保險服務。native Gemini schema 用 canonical enum；alias 處理是輸入容錯，不要求模型輸出 alias。
- structured output 與公共資料都經 Zod；禁止模型提供 readiness、currentStage、requirements weight、nextAction。
- 住院 Intent threshold 為既有 0.65；Unknown 必須要求補充說明，低信心已知需求走人工確認。文件另有既有驗證門檻，不能只看 Intent 信心。
- Journey/Document 的住院欄位是既有選填擴充；舊 flight API／來源 union／錯誤 envelope 保留。本次沒有 shared schema 變更或破壞性契約變更。
- embed 訊息需同時通過 Zod、精確 origin 與預期 window。導航目的地須存在可信本地 Sitemap／seed；不使用 `*` targetOrigin，不採用 AI URL。 目前白名單驗證不包含來源 title／retrievedAt 的逐筆等值；這兩欄只驗證格式。Backend 回答會由本地 record 重建來源；4C 需讓所有 adapter 都由可信 record 提供來源 metadata，不將 Schema 合法等同完整來源真實性。

## 前後端差距

| 項目 | A 目前 UI／Adapter | Backend main 已有 | 4B／4C 尚需驗收 |
| --- | --- | --- | --- |
| 一般入口 Intent | 呼叫 `/api/intelligence/understand` | Demo／受防護 Live + validated envelope | 否定、混合意圖、口語、Unknown 一致性 |
| `/demo`／嵌入 `mode=demo` | 全本地 Mock，沒有 API | Demo Provider 可 HTTP 呼叫 | Demo 語意與 API 同步，不改 A 視覺 |
| Journey / readiness | 瀏覽器 journeyEngine 自算 | server-owned Journey、shared 權重 | A adapter 改為渲染 server state，避免兩套規則 |
| 上傳 | applySampleDocument 不讀檔案，回固定 fixture verified | Multipart、MIME／signature／size、Demo／Live extraction、needs_review、交叉比對 | 串接實際上傳；明確區分 Mock／Live，不讓 live Intent 等同 live 文件 |
| 手動文件／人工接續 | 本機手動輸入、摘要 | 未提供手動文件 intake／請求專員接續 mutation；摘要 GET 僅回資料 | 若需要新能力先討論非破壞契約；不假裝已連接真人 |
| 醫院與住院資訊 | 原始 story 的本機解析／partner prefix match | 保守 alias、verified certificate 更新 context | A 採用共用規則；保留不確定院所與欄位矛盾 |
| 持久性 | 本分頁 sessionStorage | InMemory，TTL／容量限制 | 儲存 Journey ID、GET 恢復、404／過期重新開始，不宣稱永久保存 |
| Knowledge | 本地 searchKnowledge：results、related、highlights、hotline | JSON retrieval／grounded answer：answer、sources、supported、answerMode | 4C 對齊 adapter 與引用顯示，保留已有契約 |
| 來源／導航 | 本地 seed，可信目的地／embed bridge | seed 來源與 exact extractive guard | 補齊服務欄位、共同拒答案例、失效來源處理與導航白名單回歸 |

新增跨實作測試只證明成功路徑的 weights、required、status、stage、score 與移除文件一致；**不證明上述負向情境一致**。

## 既有住院 Backend 能力（盤點，非本次 4B 交付）

- `JourneyService`、workflow、readiness、nextAction 與 Repository 沿用原架構；住院要求集中於 `shared/hospitalization.js`。
- 初始事件 20 + 服務 15 = 35；診斷文件 20 + 有效住院資訊 15 = 70；存摺 20 = 90；確認 10 = 100。移除／替換必要文件會撤回分數及確認。
- 診斷書／住院證明抽取 hospitalName、patientName、admissionDate、dischargeDate、reportedInpatientDays、certificateKind；Backend 算住院天數並標示 dates／printed_days／user_reported。這不是保單給付日數計算。
- 存摺抽取 bankName、accountHolder、accountLast4；不回傳完整帳號。缺欄位、低信心或病患／戶名、院所、日期、天數不一致需 needs_review／HUMAN_REVIEW，不直接拒絕理賠。
- 條件性醫療文件 required=false、weight=0；存摺必備僅限這個原型的匯款示範，不表示所有理賠都一定要存摺。
- 準備完成度 100% 只表示原型資料整理完成，不表示保障適用、理賠核准、送件或核付。
- Repository 不存文件 bytes，extract 最小資料；不記錄臨床診斷、完整醫療文件或銀行帳號。尚未具備正式個資權限／刪除／稽核／多租戶隔離，僅用合成資料示範。

## Knowledge / Demo / Legacy 盤點

| 分類 | 現有內容 | 決策 |
| --- | --- | --- |
| A 比賽展示 | `data/cardif_seed_data.json`、`knowledge/cardif.js`、`hospital-documents.json`、`docs/demo-script.md`、`docs/product.md` | 展示已為住院、保單變更／受益人、借款、網路服務與 FAQ；保留並註明 snapshot／合成文件 |
| B Legacy regression | `knowledge/journeys.json`、`claims.json`、`documents.json`、`faq.json`、`sitemap.json`；flight API tests；Phase 1／2 歷史報告 | 仍被 runtime/tests 使用，保留 prototype 標示；不刪除 |
| B 評估資料 | `apps/api/eval/cases.jsonl` 120 題與固定 9 題 Live manifest | 目前沒有住院專用 corpus；120/120 不等於住院模型準確率。4B 加獨立住院案例，保留 Legacy 統計 |
| C 通用技術 | Provider、Zod、workflow、Repository、deadline／budget、來源驗證、embed | 重用，不重建引擎／Agent framework |
| D 歷史展示內容 | `knowledge/services.json` 舊旅遊／車禍清單，未見 runtime import；舊架構的手動切 tab 說明 | 保留舊資料，本次只更新錯誤的目前架構說明；後續有遷移驗收才淘汰 |

Backend 使用本地公開官網整理資料，不在 runtime 抓取官方站。來源附 sourceId／title／sourceUrl／retrievedAt／navigationDestination，類型為 public_site_snapshot；Legacy 為 prototype。資料整理日期不是有效條款更新保證，亦不代表官方授權或即時資訊。

## 建議 A 接入的既有 API

| API | 用途／相容性 |
| --- | --- |
| `POST /api/intelligence/understand` | 保留目前 envelope、meta；現在與其他 API 同樣帶 X-NAVI-AI-Mode |
| `POST /api/analyze-intent` | 保留 bare Intent 回應；不要把兩種 envelope 混用 |
| `POST /api/journeys` | `{message, intentResult?}` → 完整 Journey；可信建立結果才是工作區狀態 |
| `GET /api/journeys/:id` | 取得 server state；過期／不存在依既有錯誤處理 |
| `POST /api/journeys/:id/documents` | multipart → document、journey、readinessChange；不得在前端自加分 |
| `DELETE /api/journeys/:id/documents/:documentId` | 撤回文件／確認，使用回傳 Journey 更新 UI |
| `POST /api/journeys/:id/review` | `{confirmed:true}`，保留必要資料驗證；不送件 |
| `GET /api/journeys/:id/handoff-summary` | deterministic 摘要；不要自動加 enhance=true，以免啟用 Live wording |
| `GET /api/knowledge?query=...` | 本地 retrieval；回應不同於 A searchKnowledge，需 adapter |
| `POST /api/knowledge/answer` | `{question}` → grounded answer／真實 retrieved sources；Demo 預設零 AI |

API 是否 Live 與文件是否 Mock 是不同概念：metadata 的 provider mode 不能取代 document.isMock。本次不把 Demo provider 的成功當成真實文件抽取。

## Phase 4B 規劃（尚未開始）

1. 先與 A 對齊 adapter 邊界，採用既有 server Journey／shared 權重、保守院所比對及否定住院 guard；保留 UI／動畫及完全本地 Mock Adapter。
2. 醫療文件驗收：診斷書／住院證明／存摺、null、缺欄位、低信心、日期錯誤、帳戶／院所／天數矛盾、刪除後撤回、人工確認；只使用合成文件。
3. 新增住院 local eval corpus，區分 Demo correctness、注入 transport schema correctness 與真實 AI accuracy，保留舊 120 題與 flight regression。
4. 設計 reload／Journey 過期恢復與手動輸入的需求；若需新 contract 先說明原因與相容性，再由 A/B 約定。不要提前增加 endpoints。
5. 驗收 35→70→90→100、負向一致性、unsupported、0 Gemini。Live 醫療 extraction 需另行批准且先確認未啟用 Billing、budget；本階段不自動發送。

## Phase 4C 規劃（尚未開始）

1. 根據 local seed 補足地址變更、受益人表單、借款、密碼鎖定與服務入口的可追溯內容，包含目前 parser 遺漏的有效公開欄位；不添加猜測條款。
2. 檢索與回答分離：先可靠 retrieval；無內容／投保建議／核定／資格／金額判斷維持拒答或客服引導；只用 retrieved context，不導入 Vector DB 或付費搜尋。
3. 對齊 A 的搜尋結果型別與 Backend answer adapter；來源保持固定 ID／URL／整理日期，excerpt 必須存在來源原文，導航固定白名單。
4. 補住院與六類服務的 Local Knowledge／nav adversarial corpus、錯誤來源 ID、未允許 URL、過時 snapshot 和不足資訊測試；Legacy 分組保留。
5. 預設完全本地／Demo、0 outbound AI；若未來啟用 Live wording，沿用 Free Tier guard、ALLOW_PAID_AI=false、總 request budget 與安全 template fallback。

## 本次修改與驗證

程式只修改 `apps/api/src/app.js`、`routes/journeys.js`、`schemas/intent.schema.js`、`ai/costGuard.js`；新增 `apps/api/test/alignment.test.js`。文件修改 README、architecture 與本報告。未搬移／刪除任何產品或 Legacy 檔案。

| 檢查 | 結果 |
| --- | --- |
| 新增 alignment tests | 4/4：跨 API mode／schema、Unknown、budget 文案／狀態、A Mock 與 Backend 成功路徑 parity |
| `npm test` | Frontend 29/29 + Backend 98/98，合計 127/127，0 regression |
| `npm run eval:ai:local` | 120/120；Gemini requests=0；Legacy Golden Path 35→70→90→100 |
| `npm run build:all` | NAVI 原目錄通過；Mock 原目錄 compile／TypeScript 通過後因 macOS dataless 相依檔案 read ETIMEDOUT 失敗。相同工作源碼／lockfile 於 `/tmp/navi-phase4a-build-check` 執行 `npm ci --offline` 後，兩站 Build 均通過（exit 0），未修改原目錄 node_modules 或產品 source |
| `npm run lint` | 通過，exit 0 |
| `npm run test:sites` | 通過：root NAVI／API proxy + 乾淨副本 Mock production server；8 個模擬站路由、assets、非官方標示及 API 隔離。僅 HTTP smoke，不是完整 UI 驗收 |
| 住院 Intent smoke | root Vite proxy 回 200、X-NAVI-AI-Mode=demo、hospitalization_claim、supported、demo_fallback |
| 住院成功路徑 | Mock 與 server 35→70→90→100；移除存摺後 100→70 並撤回確認 |
| 真實 Gemini／真實醫療文件 | 未呼叫、未測試，不宣稱住院 AI 已達展示準確率 |
| A UI／動畫 | 未修改；本次未進行新的桌面／手機視覺驗收 |

本機環境限制：原目錄在 Documents 下，部分 node_modules 檔案為 macOS dataless placeholder。Build 的檔案讀取逾時不是 TypeScript 或產品編譯錯誤；乾淨副本驗證的是相同 source 與 lockfile，不宣稱原目錄完整 Build 已成功。可在正式展示前重新安裝／下載完整相依套件，避免現場讀檔等待。原 node_modules 未重建，未修改 A 的環境檔。

**零成本確認**：沒有新增相依套件、部署資源或外部服務；測試阻擋外網 AI fetch，只有注入 provider／loopback。ALLOW_PAID_AI=false、Free Tier guard、Demo／Live provider 與 budget 都保留。一般測試不驗證帳戶 Billing 狀態；API Key 無法證明 Free Tier。

Phase 4A 完成後停止；以上 4B／4C 只為規劃，需使用者確認才開始。
