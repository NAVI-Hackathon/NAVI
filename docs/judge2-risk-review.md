# 第二位評審：技術風險修復

台灣日期：2026-10-27。基準 main `ed8ff586626cf1bd18744a4bd2f2c5606a80b729`；盤點時 Production `f86d5b3a266634f2c24d610b306b454458e98a77`，不是假設最新 main 已上線。原工作目錄的未提交文件保留，使用獨立 `contract/channel-eligibility` 分支。

## 已確認缺口與本輪處置

| 風險 | 查核結果 | 修復／界線 |
|---|---|---|
| 管道 `available` 意義不一致 | 醫起通是院所比對，聯盟鏈／郵寄是入口存在 | 保留舊欄位；新增導航能力與管道 eligibility，缺事實一律 requires_confirmation |
| 文件欄位足夠被誤解為驗真 | verified 原先只有原型欄位意義 | 新增 verification scope；authenticity/eligibility 明確未評估；100%仍非核准／送件 |
| 官網 `/demo` 404 | 公開HTTP實測404；app `/demo` 為200 | Nginx固定轉官網 `/?navi=demo`，不更動app Demo；實際切換後另測 |
| 測試數字混用 | 不同評估資料集與歷史Live結果定義不同 | Live Evidence Matrix 分列，原始報告雜湊／Git SHA／日期；不合併為模型準確率 |
| 獨立泛化題組 | 找到的都是開發者題組，A使用者記錄表空白 | 新11題只稱回歸；外部題組待提供，不假稱獨立留出 |
| 12／20預算差異 | 程式daily/process預設12，Production兩者明確20 | 不改guard或配置；文件更正實際值與預設值的意義 |
| Free Tier即時狀態 | server確認旗標true，但不是AI Studio當日資格證明 | 本輪不執行Live；需新人工確認與固定生成預算 |
| 公開真實文件 | synthetic-only Session／檔案防護持續 | 不解鎖醫療／銀行真實個資；無企業驗真與正式申請 |

A 已同意相容擴充；UI／動畫與本地Demo engine由A維護。本輪沒有刪除舊測試、改動正式Seed／知識版本或調整Workflow分數。沒有修改AGENTS或舊VPS。

## 契約與測試

詳見 `judge2-contract.md`。新增 `channelEligibility.test.js` 九項測試：未知／已比對／不存在分院／模糊院名／合成院所均不產生eligible；原文來源與導航對應；舊資料相容；錯誤目的地拒絕；100%仍待確認與未驗真；90／100%刪存摺退70並撤回確認；預設12／明確20；AI不得自行指定驗真或資格欄位。既有低信心／矛盾／無關文件／manual零信用／Live無Demo回退測試保留。

`npm run evidence:demo` 於固定commit執行，以每次產生的 `report.json` 與raw logs為準：Git SHA、dirty/diff、活躍public snapshot、immutable release與各資料集SHA、指令耗時、退出碼、log SHA皆可核對。不同資料集各自報告。

第一輪固定測試commit `74a5d95afa7ba485e57e3e8011e8f911925731cf`：Frontend50/50、Backend275/275；Legacy120/120、住院76/76、Knowledge134/134；原Mock Transport27/27、新回歸11/11；Navigation107份／193步驟／7頁；Build、lint（mock）、typecheck:mock、layout、Shared Browser、Competition E2E通過。後續只補證據檔provenance，正式發布仍會在固定合併SHA重新驗證，不能用這裡的歷史commit替代部署SHA。

## 實際安全配置（盤點，未變更）

觀測 UTC `2026-10-26T18:35:02.947722+00:00`（台灣2026-10-27 02:35）：

| 設定 | 實際 Production | 說明 |
|---|---|---|
| AI_MODE | live | 不代表本輪已做真實生成 |
| GEMINI_MODEL | gemini-3.1-flash-lite | 核准模型白名單，不切付費 |
| ALLOW_PAID_AI | false | 無付費備援／Grounding／Vertex |
| daily / process cap | 20 / 20 | 明確env覆寫；程式預設12/12不變 |
| session / concurrency | 6 / 1 | 匿名合成測試仍受控 |
| timeout / attempts | 10000ms / 1 | 不自動重試 |
| GEMINI_FREE_TIER_CONFIRMED | true | 歷史人工確認配置，不是即時帳戶查核 |
| synthetic-only/public synthetic | true / true | 可上傳自行產生的合成文件，不接受真實個資 |
| 持久用量帳本 | Pacific 2026-10-26 used6，lease0 | 僅本地使用上限紀錄，不是Google剩餘配額 |

環境與帳本SHA保留本機以部署前後比較；不提交Secret或API Key。部署後用新一份實際觀測回報，不將這裡的資源用量當成未來狀態。

## 未完成與企業邊界

- A需將管道視為資訊入口，顯示條件待確認及文件未驗真；舊缺值保守處理。沒有新data-tour-id需求。
- 新的Live模型及外部獨立題組尚未驗收，歷史結果保留完整成功／失敗；本輪Live請求0。
- iPhone Safari實機仍待A；桌面模擬不是實機。
- 企業官網／SSO／保單API／客服／文件保管刪除／法遵見 `judge2-integration-boundary.md`；核心沿用，不另外建引擎。
- A的真人任務研究尚無資料，不編造成效。成本使用可追溯公式及unknown輸入，不假稱企業部署永遠零成本。
- 簡報、錄影、完整原始API或個資紀錄不推送公開GitHub。完整執行／上線報告留本機artifacts。
