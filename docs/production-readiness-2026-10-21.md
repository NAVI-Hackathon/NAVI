# NAVI 最新 main 同步與上線準備

## 同步及範圍

- 原工作目錄 HEAD：`8d902f23a95a22a2e0bab09b1c842f5e0d5d785a`。
- 本次基準 origin/main：`05d35f4c9e2beb90f348e2cb4a457ba184235d41`。
- A 的更新：`2e78740` README 驗收紀錄、`7aa973b` 刪除前端舊搜尋（保留 shared 引擎）、`05d35f4` 三段式展示草稿。
- 獨立 worktree／`fix/production-readiness`；原目錄 `docs/phase-2a-report.md` 未提交修改與全部忽略／未追蹤檔保留。沒有 reset、clean 或覆蓋 env。
- 使用者已確認通知 A 並同意 Backend／shared 相容擴充；正式模式手動輸入 UI 由 A 接入。NAVI UI、動畫與 Workflow 權重未重做。
- Mock 名詞頁只換資料來源與逐項來源標示，維持既有版面。`apps/web` 只調整導航測試以驗證新增名詞錨點。

## 四項產品問題

1. 地址：保留 `service:change_address`、`/services/policy-change#service-change-address`。移除 public online_available 的內部筆記，備註移至不被公共 schema 接受的 internal_notes。公開欄位逐行核對本次官網 a312 文字；區分戶籍／收費地址申請說明與 My Cardif 通訊地址管道／會員條件。沒有新增申請網址或臆測處理時間。
2. 名詞：移除硬編碼暫時定義，採用 seed 中7個官網短定義：被保險人、要保人、受益人、保險年齡、保險費、保單管理費、保單帳戶價值。附類別、keywords、來源URL、擷取日期；不是個別保單條款。Shared 搜尋新增 `glossary:<slug>`，原 service/form/faq/claim-doc/claim-rule 編號不變，導航只新增實際存在的白名單錨點。
3. 擷取：沿用 crawler，新增 fail-closed robots、逐跳 redirect 白名單、2MiB回應上限、不可覆蓋舊 Snapshot、指定起始頁與不追連結選項。實際只擷取7個公開頁面、間隔2秒，記錄38個文件連結；未下載PDF或圖片、未碰登入／第三方限制。Python工具在本地獨立venv，未在VPS執行。
4. 手動文件：原本正式模式明確停用，因為尚無 Backend API；不是應取消的驗證限制。本次提供獨立待確認資訊API，永遠不寫入文件證據或Intent已確認欄位，也不授予分數。前端UI仍由A處理。

## Snapshot 審核

本地 `data/crawl/review-2026-10-20/`：robots、pages.jsonl、documents.json、comparison.json、review.json。retrievedAt 為實際擷取 UTC 日期2026-10-20（台灣跨日工作紀錄為10/21），不是全站資料更新日。

只人工核對並採納地址公開欄位與7個名詞。seed `meta.crawled` 仍為2026-10-06；新增 row-level retrievedAt 只用於新核對的條目，其他來源沒有偽造更新日期。Shared evidence、Backend sources 與 navigation 會使用相同條目日期。

| 來源 | 本次檢查 | 採納狀態 |
|---|---|---|
| a312 保單變更 | 地址、受益人、表單與會員條件 | 地址欄位已採納；其餘候選待審 |
| a314 理賠 | 門診收據、住院診斷書／住院證明、依病況文件、匯款存摺規則 | 查得對應文字；未重寫Phase4B規則／合作醫院清單 |
| a313 借款 | 申請方式、合約書等公開資料 | 保留候選及原有資料日期 |
| a311／a3 | 表單名稱及PDF連結 | 不下載或冒稱已讀PDF內容 |
| f8 網路服務 | 密碼／會員服務資訊 | 保留候選；未宣稱完整FAQ更新 |
| insurancedictionary | 官網名詞文字 | 7個短定義已採納 |

FAQ入口為外部LINE／maac.io，未擷取受限制第三方。舊資料部分為人工整理摘要，字面不同不能直接視為規則改變；comparison.json 的literal match只供審核，不代表事實正確率。未批次覆蓋整份seed。執行時仍只讀本地資料。

## 手動文件 API／A 整合方式

新增（舊 endpoints／DocumentSchema 不變）：

```text
POST   /api/journeys/:id/manual-document-information
DELETE /api/journeys/:id/manual-document-information/:documentType
GET    /api/journeys/:id   # optional manualDocumentInformation
```

```json
{
  "documentType": "diagnosis_certificate",
  "fields": {"hospitalName":"NAVI 合成醫院", "admissionDate":"2026-10-01", "dischargeDate":"2026-10-05"}
}
```

診斷資訊可填 hospitalName、admissionDate、dischargeDate、reportedInpatientDays；存摺資訊可填 bankName、accountLast4（僅4碼）。欄位皆可部分提供但至少一項非null；不接收病情、完整帳號、姓名、任意備註、confidence、status或readiness。

回應 `{ information, journey, readinessChange }`。information 固定 `source:"manual"`、`status:"needs_review"`、updatedAt，儲存在 Journey optional `manualDocumentInformation`（每類一筆、最多兩筆）。同類重填取代；不是文件上傳，不會產生 Document ID／matchedRequirements。識別資料誤填名稱欄位會遮蔽，不記錄body或醫療內容。

手動資料不增加文件分數，也不能解鎖 Review／READY_TO_PROCEED；變更會撤回原確認。真正文件驗證（含跨文件一致性）通過後，才清除該類手動資訊並沿用既有Workflow重新計分；驗證失敗仍需專員確認。支援刪除手動資訊，保留原已上傳證據。

錯誤沿用 `{success:false,error:{code,message,retryable}}`：400 INVALID_INPUT、404 JOURNEY_NOT_FOUND／MANUAL_INFORMATION_NOT_FOUND、409 SERVICE_NOT_SUPPORTED／HUMAN_REVIEW_REQUIRED。沒有讓模型或使用者指定商業狀態。

A：保持 `/demo` Adapter 與正式API分離。正式模式可新增「先提供資訊（尚未驗證）」；使用上述Request Schema、顯示待確認標籤並保留上傳CTA。不可將 manualDocumentInformation 渲染成 verified 文件。舊一般流程不主動加入此欄位；有使用新endpoint的client須採本版shared schema，舊版strict decoder不能處理新opt-in欄位。

## Gemini Timeout 調查

已證實（靜態程式＋注入transport測試）：

- 預設 gemini-3.5-flash-lite、MINIMAL thinking、Structured JSON Schema＋Zod；model由集中設定讀取。
- Backend預設10秒deadline（設定1–12秒），兩次attempt共用同一deadline，含JSON body與cache階段；最多retry1次，不會每次重新給10秒。呼叫鏈為routes → intent/document/answer service → requestValidatedAI → provider。
- 429有限重試及budget停止、空JSON／schema錯誤安全處理。Intent／文件Live失敗不偷偷變Demo。Knowledge非關鍵文字逾時可回真正檢索原文，answerMode=retrieval_template。
- 前端Intent等待12秒、Journey一般15秒、文件45秒是client上限；不代表Backend會呼叫45秒。前端fallback需明確設定，結果有demo_fallback標記。
- Timeout API回504／AI_TIMEOUT、retryable=true，文案提供重試、示範或專員協助。模型metadata不含key、文件或PII。

未證實：A先前30秒生成請求的實際發送路徑、供應商狀態、帳戶quota、網路或UI等待。沒有原請求trace，不能歸因Free Tier排隊；本次沒有真實模型呼叫。

官方參考（僅讀公開文件）：[模型](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)、[價格與Free Tier](https://ai.google.dev/gemini-api/docs/pricing)、[故障排查](https://ai.google.dev/gemini-api/docs/troubleshooting)。文件有列此模型與免費級別，但**不證明特定API Key帳戶的計費狀態或即時可用性**。不更換模型、不使用Search Grounding。

日後若獲額外授權：建議最多2個合成Intent請求（包含retry的總HTTP預算），先由使用者確認專案未開Billing、指定Free Tier model、設LIVE_AI_REQUEST_LIMIT=2並確認CI阻擋未被移除；記錄純錯誤碼／latency，不記錄內容。本次未執行。

## Regression 與部署狀態

- npm test：Web32/32、API139/139，共171/171；保留全部舊案例。
- npm run lint、npm run build:all：通過；Production靜態export由部署builder另在本機產生。
- eval:ai:local 120/120、eval:hospitalization 76/76、eval:knowledge 107/107（新增4題地址＋7題名詞）。
- Crawler單元測試4/4：robots拒絕／不可用、外部redirect、舊Snapshot不可覆蓋。
- 新增11項應用測試：手動資訊5、來源／地址／名詞3、deadline及知識回退3；並擴充既有來源日期與導航anchor檢查。沒有移除舊測試。
- 所有測試採本地／注入Provider，0 Live Gemini、0新增Production相依套件、0付費API。
- Knowledge Metrics：Top-1 71/71、Top-3 71/71、Unsupported拒答與Out-of-scope檢出均100%；Invalid Source／Route均0。本地p50 0.23ms、p95 0.815ms；這是本地檢索計算值，非Gemini準確率或API SLA。

SSH已成功驗證新VPS207.148.113.119：Ubuntu24.04.5、Node22.23.3、API／Nginx正常。驗收前未切換公開release，仍運行先前7329f62；新版須通過測試、PR審閱與確認後才部署。未連線舊VPS。

限制：HTTP合成資料展示，不能接收真實醫療／銀行資料；InMemory非會員案件服務，沒有正式送件或理賠判定。本次未重做A的UI，也未自動執行Live evaluation。
