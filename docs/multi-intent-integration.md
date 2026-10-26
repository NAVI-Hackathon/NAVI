# Multi-Intent、Receipt 與 Navigation 整合

基準 main：`cebbcbc4772f88daabeca309816b63688c8d4158`，已包含 A 的 `ed8ff58`。A 已同意本輪相容行為修正、測試更新及 optional `Document.requiresRevalidation`；不修改 UI、動畫或 Guided Action 元件。最終測試／部署 SHA 以該次本機發布報告為準。

## 呼叫圖與額度

1. `POST /api/intelligence/tasks` → 一次 Provider `understandTasks` → 一次 Gemini structured generation（正式模式）。完整性／否定／schema 驗證後，每個任務在伺服器建立 Receipt。
2. 使用者選擇任務；只有需要完整住院流程時，A 用 `message=task.input`、既有 `intentResult` 呼叫 `POST /api/journeys`。Backend 只接受 Session 內已驗證的解析結果，不信任瀏覽器回傳的分類。
3. Receipt 建案不呼叫模型；同一任務的平行／重複建案回傳同一 Journey。兩、三個任務可分別選擇，彼此不覆蓋。地址等純知識任務仍由 A 顯示來源，不強制建立假的完整 Workflow。
4. 兩份文件各自分析實際 bytes，各產生一次獨立模型請求。正常單一住院流程是 **1 + 0 + 2 = 3**，不是把 HTTP request 數當作模型數。
5. 舊 `/tasks` 404 客戶端仍可 `/intelligence/understand` 一次，再用該結果 Receipt 建案；不加第二次理解。重新整理以原 Cookie 與 Journey ID GET 狀態，不自動重新生成。

Production 維持持久 daily=20、process=20、Session=6、併發=1、attempts=1、timeout=10000ms，沒有提高額度。Session 現在於 **Provider 嘗試** 時同步扣額，不在建案／手動資訊／GET 等 HTTP 動作扣額；供應商前置護欄拒絕或失敗的嘗試仍可能保守占 Session 額度。真正外送生成量另由 Provider transport、process budget 與持久 ledger 驗證，不能把 Session attempts 當作 Google 用量。既有 5 秒節流不變。

本輪一般回歸均注入 Mock Transport，**Google 生成=0、付費 API=0**。測試用時鐘跨過節流間隔，不修改 Production 護欄。Google AI Studio 當日免費配額未重新查核，不沿用舊授權發出 Live 請求。

## Receipt 契約與失效

Receipt 是 Session 私有的伺服器記錄，不是相信前端的一段 JSON，也不是新公開 token。內容綁定原始文字片段驗證後的 canonical input 雜湊、解析結果、task ID、實際 Provider、允許的 `create_journey` 操作及 5 分鐘期限。Cookie 仍為 HttpOnly／Secure／SameSite Strict，案件 ownership 不變。

- 有效 Receipt：忽略 browser `intentResult` 的事實／分類；重複建立回傳同一 ID 與**目前**狀態。即使已修正需求，重放也不會重建舊住院分數。
- Receipt 缺少／過期／input 改動／其他 Session：帶 `intentResult` 的選擇回 `409 INTENT_RECEIPT_REQUIRED`，訊息「需求分析已失效或內容不符，請重新分析後再選擇任務。」不隱藏重試 Gemini。
- 舊式直接建案若沒有 `intentResult`，仍可由 Backend 真正理解一次；不接受用 browser facts 代替分析。
- API timeout 不核發成功 Receipt；使用者要明確重新分析，不自動重送。
- Receipt／案件為原型單程序記憶體；服務重啟／Session 到期會失效。持久每日額度不隨重啟清零，不建立未授權的跨裝置同步。
- 回應 shape、既有 endpoints 與 `201` 相容；A 可補 `INTENT_RECEIPT_REQUIRED` 文案，保留其他待辦任務，提示使用者重新分析，不能自動以原操作再試。

## Task input 與 Demo

Gemini raw task 仍必須引用完整、連續、不重疊的原文，並覆蓋整個需求；不容許編造、漏掉後半句或刪掉否定。通過驗證後，只由 Backend 補足顯示語法，例如 `也想知道…` → `我也想知道…`，再以 canonical input 核發 Receipt。單任務保留完整原訊息，符合 A 的呼叫方式。

Demo 確定性拆句保留 `也想`、`順便` 等連接語，沒有對 `但不想`／`沒有` 任意切割；缺少獨立對象的門診追問保留整句上下文。範例：

| 輸入 | 回傳任務 input |
|---|---|
| 我想改地址，也想知道要怎麼申請住院理賠。 | 我想改地址；我也想知道要怎麼申請住院理賠 |
| 我要變更地址，順便下載申請書。 | 我要變更地址；我順便下載申請書 |
| 我昨天只是門診，沒有住院，也想問文件。 | 完整保留一項，不啟動住院流程 |
| 我想改地址，但不想變更要保人。 | 完整保留一項，不新增要保人變更任務 |

Backend Demo Provider 與正式 Gemini 分開；公開 `/demo` 仍是 A 的本地 Adapter，沒有新增後端 Demo API。其既有 capabilities 沒有 tasks／correction，因此本輪不擅自把新 UI 功能加進本地 Demo。正式多任務／修正的 Browser 整合使用 A 的正式 Adapter，加本機 Mock Transport 驗證；不能稱為真實 Gemini 成功。

## Navigation 行為修正

| Root Source ID | 修正前 | 修正後 |
|---|---|---|
| `service:change_address` | 地址說明 → 契約變更表單 → 同一地址說明 | 地址說明 → 契約變更表單（2步） |
| `form:form_contract_change` | 表單 → 反向關聯的3個其他服務 | 只有契約變更表單（1步） |
| `claim-doc:2` | 住院文件 → 保險金申請書 → 郵寄管道 | 同左（3步，僅查看資料，不代表已適用） |

服務只展開 Snapshot 明確連結的表單；理賠文件保留其明確向前關係；表單與 FAQ 不再把「誰引用這筆資料」或「同來源頁相鄰服務」當作必走操作。依 path＋anchor 去重，不補滿步數。每步仍驗證 Source ID、原文、來源日期、可信目的地與建置 DOM manifest。未知來源回 not_found；缺錨點／過期 manifest 回 `NAVIGATION_TARGET_UNAVAILABLE`。

沒有新增錨點，A 不需加特殊 case。既有長度可變 Plan shape 不變；需同步發布新 Shared Engine、Frontend Bundle 與 Backend，以免舊 canonical plan 被當成新計畫。舊瀏覽器應重新取得計畫，不能重放快取舊步驟。

## Intent Correction 與文件撤回

`POST /journeys/:id/intent-correction` 仍回完整 Journey（原 ID 的新狀態）。更換服務時清除舊服務來源／管道／分數；即使仍是住院服務，保留文件也加 optional `requiresRevalidation:true`，只供確認、status=needs_review、matchedRequirements=[]，不拿舊證據繼續計分。Gemini raw document schema 不接受這個 authority 欄位。

重新上傳通過 Backend 欄位／一致性檢查後才清除該文件的標記、重算分數。正常35→70→90→100、移除存摺撤回70及 confirmed=false 不變；verified仍不是文件真偽、100%仍不是核准／送件。

同項分析重入回 `JOURNEY_BUSY`；分析期間刪文件、修正需求等新操作使晚到的結果回 `JOURNEY_STALE`。GET 可取得完整新狀態，前端只更新顯示，使用者確認前不自動重送；其他 Journey 不受影響。

## A/B 使用者量測共用定義

直接使用 `docs/usability/protocol.md` 第4、5節、現有 CSV 與 `scripts/usability/summarize.js`，不另建平行格式。

- 開始：受試者唸完任務卡，主持人說「開始」；結束：在正確目標說「找到了」（表單題也須按下載）。
- 追問、閱讀、載入、模型等待、導覽、換頁與返回都包含在 `time_s`。Backend latency 另列技術指標，不從使用者時間扣掉。
- 180秒內、無協助、到正確位置才 success=1；聊天裡讀到答案不算。失敗／放棄／超時填180，時間中位數只取成功者。
- `wrong_clicks`：最短路徑外的頁面／分頁／選項，含 NAVI 選錯；捲動不算。`help=1` 表示曾獲提示，success須為0。
- `seq`與`confidence`均1～7，定義完全沿用A。notes不記個資；求助、卡住及退出如實記錄。
- CSV欄位：`participant,order,segment,condition,task_set,task,time_s,success,wrong_clicks,help,seq,confidence,notes`。B條件是本地Demo，報告須明示，不能當成Live時間。
- 目前紀錄表仍空；執行 summarizer 回「尚無資料」。不編造完成率、改善百分比或真人效益。

## 驗收與公開界線

本輪新增單／雙／三任務、Receipt reuse／tampering／expiry／Session、並行重複建案、實際 transport 計數、舊404回退及重整恢復、timeout不隱藏重試、否定拆句、Navigation去重、同類意圖修正與stale/busy測試。修正既有測試的三步假設，不刪除測試以提高通過率。

每次完整報告記錄測試 Git SHA、dataset SHA、原始 log SHA，離線評估不是 Gemini 準確率。正式公開站只能使用合成資料；不解鎖真實醫療／銀行文件、不改Key／計費／額度／Nginx安全設定。部署保留前版及合成測試權限；iPhone Safari實機由A複驗。
