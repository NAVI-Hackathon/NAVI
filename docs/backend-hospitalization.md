# Developer B · 住院 Backend 與 PR #2 Review

日期：2026-10-12。同步 main 至 `32a6c6a` 後實作；Developer A 的 `apps/web`、`apps/mock-site` 與 SEED 均未修改。原有未提交的 `docs/phase-2a-report.md` 修改保留、不納入提交。依最新 AGENTS 在 `codex/backend-hospitalization` 工作，不直接推 main。

## PR #2 Review

[PR #2](https://github.com/NAVI-Hackathon/NAVI/pull/2) 已合併；review 比較 base `310c27d` 與 head `1056daa`，並追查目前 main 呼叫端。本機黑客松 Demo 是本次負載假設，不聲稱可直接多租戶上線。

| 級別 | 實際問題／例子 | 本次處理 |
| --- | --- | --- |
| Critical | 未發現 | 沒有編造 Critical finding |
| High | `intentPrompt.js` 將門診／手術算入住院；Demo「只有門診開刀，沒有住院」也會開住院旅程；`medical_claim` 無住院線索仍被 alias 成住院 | 限縮 Prompt、否定情境正規化、medical alias 需有明確住院線索；門診仍可查 SEED 知識，但沒有住院 workflow |
| Medium | `NavigationTargetSchema` 只驗證 URL 形狀，`/admin`／假 anchor／假官網路徑仍可通過 | 對 SEED 的 page＋anchor＋source URL 組合白名單驗證；保留 A 現有合法目標 |
| Medium | 共用文件 Schema 已加住院文件，Gemini 文件 Schema 與 Backend validation 未支援 | 擴充 multimodal Structured Extraction、欄位驗證、住院來源與交叉驗證，不把新增型別直接當 verified |
| Medium | 新增測試只涵蓋 happy path 分類；未測否定住院、無欄位、矛盾、非法導覽 | 新增 HTTP Golden Path、失敗／回復、source/window、假 ID／摘錄與注入 transport 測試 |
| Low | 展示腳本／產品文件仍描述班機延誤 | 遷移展示文件與 Knowledge inventory，Legacy tests 保留 |
| High（已修正） | PR `readMessage` 在 expectedSource 未建立時跳過視窗驗證 | `c59a65a` 已 fail closed；本次保留並新增 Backend regression，不重做 iframe |
| High（已修正） | Backend 住院 Journey title 缺值會 500 | `c59a65a` 已修預覽；本次正式新增 supported 住院 workflow |

enum 名稱保留。Gemini Intent JSON enum 使用共用 Zod enum；raw normalization 只接受明列 aliases，未知值降為 unknown／低信心，extra 商業欄位 reject。既有 Gemini JSON Schema 比 raw Zod 更窄（只允許 canonical enum、0–1 confidence）是刻意設計；容錯正規化不擴大公開契約。

## 修改範圍

- `apps/api/src/ai/`：Demo fixtures、Gemini intent／document Schema、三種 Prompt 與版本。
- `apps/api/src/schemas/intent.schema.js`、`services/intent.service.js`：統一否定住院防護與 enum 正規化。
- `services/journeyService.js`、`documentService.js`、`documentValidationService.js`、`evidenceConsistencyService.js`、`workflow/journeyStateMachine.js`：沿用引擎新增住院、文件驗證、矛盾與準備度。
- `services/knowledgeService.js`、`knowledgeAnswerService.js`：本地 Cardif 檢索與來源／摘錄驗證。
- `shared/intelligence.js`、`shared/journey.js`；新增 `shared/cardif.js`、`shared/hospitalization.js`：相容欄位、可信目的地及集中規則。
- `knowledge/cardif.js`、`hospital-documents.json`、`README.md`：新增本地知識與合成文件，Legacy 盤點。
- `apps/api/test/hospitalization.test.js`、`journeys.test.js`、`sampleDocuments.js`：成功、失敗、回復、契約與零網路測試。
- 根 README、`docs/demo-script.md`、`docs/product.md` 與本文件：展示與交接對齊。

`shared/embed.js` 保留既有實作，本次僅新增回歸測試；SEED、前端、相依套件、lockfile、AGENTS 與環境設定均未修改。

## 架構與 Workflow

React（A 現有 Adapter）→ NAVI API → Demo／Gemini Provider → Zod → 文件／一致性驗證 → 原有 JourneyService／Workflow／Readiness／NextAction → InMemory Journey。

Gemini 不回傳 readiness、state、nextAction、資格或規則權重。Backend 依 `shared/hospitalization.js` 計算：

| 項目 | 分數 | 檢查 |
| --- | --- | --- |
| 事件 | 20 | 有使用者事件描述 |
| 服務 | 15 | 辨識住院需求 |
| 診斷書或住院證明 | 20 | 有病患、醫院、有效住院期間／明載天數及足夠抽取信心 |
| 住院資訊 | 15 | 同份已驗證文件的住院資訊完整 |
| 存摺 | 20 | 匯款示範：銀行、戶名、末四碼完整；與病患姓名一致 |
| 確認 | 10 | 必要證據齊備後使用者確認；不是實際申請書／簽名驗證 |

35／EVIDENCE_COLLECTION → 70 → 90／READY_FOR_REVIEW → 100／READY_TO_PROCEED。移除／替換文件撤回確認並重新推導分數。部分欄位缺少或矛盾 → needs_review／HUMAN_REVIEW；重傳可回復。

住院入口信心 threshold 使用共用 Intent threshold（預設 .65，對齊 A）；文件驗證使用原有 JOURNEY_CONFIDENCE_THRESHOLD（預設 .75）。班機 Legacy 的 .55／.75 行為不改。confidence 是模型估計，非已校準機率。

## 文件 Schema 與 Validation

- `diagnosis_certificate`：hospitalName、patientName、admissionDate、dischargeDate、certificateKind；後者可為 `hospitalization_proof`。不可見欄位 null。
- `reportedInpatientDays` 只代表文件明載天數。Backend 另算 `inpatientDays`／`inpatientDaysSource`；完整有效日期含入／出院日，否則使用明載天數標示 printed_days；均不是核付日數。反向／無效日期不會 verified。
- `bank_passbook`：bankName、accountHolder、accountLast4；不要求或輸出完整帳號，full accountNumber 為 Schema 錯誤。
- 不擷取或持久化臨床診斷文字；舊契約的 diagnosis 欄位回 null。醫療／存摺 filename 改為類型名稱，避免文件名夾帶個資。
- 文件 confidence 與必要欄位皆足夠才 verified。這代表原型資料結構已驗證，不保證正本／印章／真偽或帳戶有效性。
- MIME、header signature、10 MB、structured validation、shared timeout／最多一次 retry 沿用原有防護。文件不符目前旅程回 422 DOCUMENT_SERVICE_MISMATCH，不修改 Journey。
- 病患與戶名、醫院（先做臺／台與保守別名正規化）、入出院日期、回報／明載天數矛盾會 flag。訊息不含姓名、帳號或醫療內容。

文件 bytes 只在當次 request 與 provider 呼叫中使用，Repository 不存 bytes。抽取的最低必要欄位暫存於既有 InMemory（100 案／1 小時 TTL、重啟清空）；沒有新增 DB 或永久文件儲存。不要以本原型接收真實病患或銀行資料。

## 官網規則與 Knowledge

資料只讀 `data/cardif_seed_data.json`（整理日期 2026-10-06），沒有擴寫條款或網路抓取。診斷書／住院證明是替代；依病況文件 required=false、weight=0，不阻擋原型完成度。存摺標示「匯款給付示範」，不是每個理賠案件都必備。

院所明列別名：台中榮總／中榮、台大／臺大、北榮／高榮／三總等。只比對已知名單與明確別名；未列分院與沒有城市的「榮總」不猜為合作院所。

醫起通合作資料／診斷書提醒、聯盟鏈會員／本人條件、10 日內寄正本、單次核付超過 30 萬元提醒與郵寄說明直接讀來源。channel.available 是原型導航可顯示性，不代表已通過管道資格。非合作院所只引導查看聯盟鏈或郵寄條件。

`knowledge/cardif.js` 建立服務、表單、FAQ、應備文件與一般規則的本地索引；支援住院、地址、受益人表單、保單借款、密碼鎖定、官網入口。回答採原文行摘錄：每行需在檢索來源中逐字存在，source IDs 必須來自檢索結果；模型不能產生新來源／目的地。缺資料／投保建議／理賠資格或金額判斷時回資訊不足，不呼叫 Provider。

來源新增 union variant `public_site_snapshot`：id／sourceId、title、section、url／sourceUrl、retrievedAt、navigationDestination。這是團隊整理的公開網站快照，不是即時官方回應或完整條款。舊 prototype 來源格式完全保留。

## API 相容性與 A 接入

所有既有 endpoint／envelope 保留；新增住院 enum 已存在，不重新命名 intent。Intent extractedData 新欄位選填；Document 衍生欄位／certificateKind 選填；ClaimContext 的 inpatient 選填；增加 Source union 與 ConsistencyIssue enum。不移除既有合法欄位或來源型別。非法導覽收緊是安全修正，A 現有合法目標仍通過測試。

| A 可接入 API | 用法 |
| --- | --- |
| POST /api/intelligence/understand | 既有入口相容 envelope |
| POST /api/journeys | `{message}` 或舊 `{message,intentResult}`，取得伺服器 Journey／id |
| GET /api/journeys/:id | 讀完整 server-owned 狀態 |
| POST /api/journeys/:id/documents | Multipart file；Demo 明確提供 diagnosis_certificate 或 bank_passbook；Live 以實際文件分類 |
| DELETE /api/journeys/:id/documents/:documentId | 刪除、撤回準備度／確認 |
| POST /api/journeys/:id/review | `{confirmed:true}`，只有證據齊備才成功 |
| POST /api/knowledge/answer | `{question}` → answer、sources、answerMode、supported；sources 內附可信導覽 |
| GET /api/knowledge?query=... | 不經 AI 的相同本地來源查詢 |
| GET /api/journeys/:id/handoff-summary | 收集／缺少／矛盾摘要，條件性文件不當成每案 missing |

A 應直接使用 API 回傳的 readiness／stage／nextAction／claimContext，避免再算一套正式 business rules。前端 Mock Adapter 可保留作離線示範；目前 A 尚未接入本次 server-owned 文件／知識流程，不會因本次後端修改自動變成真實 AI 文件辨識。

## Legacy 遷移與零成本

完整 A／B／C／D 清單見 `knowledge/README.md`。展示腳本與 product 已遷移，舊 unsupported 住院預覽測試改為 server-owned 成功與安全失敗測試；班機／車禍資料、enum、120 個 Legacy 合成評估保留，不作保險公司服務宣傳。沒有直接刪除被測試依賴的程式。

Free Tier Guard、ALLOW_PAID_AI=false、共享 Live budget、外網 test guard、Demo Provider 皆保留。沒有增加 dependencies、付費服務、RAG、DB、Auth 或 Agent framework。本次新增真實 Gemini 請求 **0**；AI transport 測試完全注入假 fetch；不將其算作真實模型理解／辨識能力。

## 驗證紀錄

| 項目 | 結果 |
| --- | --- |
| `npm test` | 123/123：Frontend 29、Backend 94；0 失敗 |
| `npm run eval:ai:local` | 120/120；Legacy Golden Path 35→70→90→100；Gemini request 0 |
| `npm run build:navi` | 成功，最終 Vite Build 145ms |
| `npm run build:all` | NAVI 成功；Mock Next Build 在本機依賴讀取／PostCSS 階段等待超過 26 分鐘，人工停止，未取得成功／編譯錯誤結果 |
| `npm run lint` | 本機依賴讀取等待超過 34 分鐘，人工停止，未取得 lint 結果 |
| 實際 HTTP Demo | health、Vite API proxy、住院 35→70→90→100、刪存摺回 70、六類知識查詢全部通過 |
| API Key／環境檔 | 本機 Key 未出現在 Frontend bundle；實際 `.env` 不被 Git 追蹤 |
| 前端／個資／成本 | 前端 source 無差異；只用合成文件，無真實病患／銀行測試資料；真實 Gemini 請求 0、新增付費依賴 0 |

雙站 smoke 與瀏覽器端到端未完成；不能將後端 HTTP Demo 等同於嵌入式前端驗收。交付維持 draft PR，不合併 main；需在相依檔案能正常讀取的環境重新完成 Mock Build、lint、雙站 smoke，並由 A review 共用契約與接入 Adapter。

## 限制

本地 Knowledge 仍為 keyword／bigram 檢索，未驗證所有自然語言長尾問題；不宣稱模型／搜索 accuracy。手動欄位修正 API 尚未新增，可用重傳修復。完整正本、病患／銀行身分驗證、管道資格與核付仍需保險公司／真人。InMemory 無 Auth，只適用合成資料本機 Demo；Live 真實模型的住院辨識準確率未測。後續先由 A 接入 Adapter 並跑嵌入式端到端，再另確認後續階段。
