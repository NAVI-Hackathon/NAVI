# 技術稽核 Gap Matrix：證據與部署邊界

基準 `32901cd3838913438389ac8fd01095c8c6bd74a3`；Production 保留 `13d7fcb706818ffae99ac195d63e73521675c8c4`。後續實際執行 SHA、時間、原始 log/hash 放本機 Evidence Pack，不把歷史成功冒充新版本結果。這不是保險資格、安全認證或正式企業就緒聲明。

## 風險盤點與 15 項高風險回歸

| # | 風險／能力 | 狀態 | 可重現檢查與限制 |
| --- | --- | --- | --- |
| 1 | 缺 Eligibility 被當可申請 | 已實作且有測試 | channelEligibility.test.js、A journey tests；缺值／合作院所／100% 都不推定資格 |
| 2 | 明確不符合、仍顯示可辦 | 已實作且有測試 | A channel wording，ineligible Schema；Backend 缺足夠保單事實時只產生 requires_confirmation，不發明核賠規則 |
| 3 | Unknown／否定門診誤開住院 | 已實作且有測試 | reliabilityAudit R04/R14、Holdout H02/H11/H19；Live 泛化尚未驗證 |
| 4 | 多任務漏掉／修正後舊件復分 | 已實作且有測試 | taskReceiptIntegration、R01/R04、requiresRevalidation；其他獨立 Journey 保留 |
| 5 | 文件不符或矛盾仍加分 | 已實作且有測試 | documentAdversarial、hospitalization、syntheticVerification；Mock 不是視覺品質證據 |
| 6 | 刪匯款件後仍90/100% | 已實作且有測試 | R06、channelEligibility；撤回到70且 confirmed=false，stale handoff 拒絕 |
| 7 | AI 可控制業務狀態／Injection | 已實作且有測試 | strict schemas、R02、documentAdversarial；Live 文件 Injection 防禦仍待真實模型評估 |
| 8 | Live 失敗回 Demo 假資料 | 已實作且有測試 | live-isolation、publicLive、timeoutReadiness；Header 與來源由 Backend 決定 |
| 9 | 超額、併發、重啟重設配額 | 已實作且有測試 | durableQuota 原子檔案、production gate／session charge；單 VPS，不宣稱多節點一致性 |
| 10 | Stale Journey／跨 Session／多分頁 | 已實作且有測試 | R05/R07/R08、task receipts/session isolation；正式站不注入破壞性故障 |
| 11 | 重啟後幽靈案件或資料同步 | 已實作且有測試 | R09：InMemory 案件過期回 not_found，不重建舊分數；持久跨裝置尚未實作 |
| 12 | 假來源、假摘錄、過期／待審內容 | 已實作且有測試 | sharedKnowledge、knowledgeLifecycle：假日期/hash/來源拒絕，pending不發布；快照非即時官網、沒有保證更新SLA |
| 13 | 導覽到不存在或不相關位置 | 已實作且有測試 | navigationAudit、manifest、Browser E2E；form1步、address2步；只驗自建模擬官網 |
| 14 | 敏感內容公開／Upload 濫用 | 已實作且有測試 | publicKnowledgeSecurity、Session/attestation、Magic/container、private logs；公開只限合成，非完整媒體解碼／惡意檔掃描 |
| 15 | 假性能／錯把規則通過率當 AI 品質 | 本輪補齊量測工具 | Frozen dataset、獨立 scorer、Evidence Pack、loopback load、只讀 Production；不合併不同分母 |

## 尚未驗證／企業導入範圍

| 項目 | 分類 | 需要的證據或系統 |
| --- | --- | --- |
| 目前 main 的真實 Gemini 品質 | 已實作但未驗證 | 無新 Live 授權；新題組、6次提案與歷史紀錄分開，見 ai-evaluation-protocol.md |
| 獨立非開發者 Holdout | 尚未實作 | 非開發者題目／Ground Truth 尚未收到；不能把本輪回歸集改名冒充 |
| 真人效益數據 | A 執行中，尚未收到原始紀錄 | 統計工具已可用；本機 CSV 仍空，不推論實際參與人數，也不產生改善率 |
| iPhone Safari 真實鍵盤／觸控 | 已實作但未驗證 | A 實機操作；375/390/430 Chromium 模擬不替代 |
| 真實個人醫療／銀行文件 | 企業導入階段才需要 | 核准 Provider 資料政策、合法依據、SSO/保單授權、完整解碼／掃描及加密保管刪除 |
| 真的送件／客服工單／核賠 | 企業導入階段才需要 | 官方 API、正式權限、CRM傳送回條；現在100%只表示原型資料準備完成，handoff不傳送 |

## 本輪最小修正

不重寫 Provider、Knowledge、Workflow、UI 或 shared Contract。新增評估器與其反向測試，對錯答、額外欄位、缺值、逾時及錯誤真正扣分；拒絕混用模型／版本／Mock/Live。

使用者統計補拒絕小數指標、重複紀錄、成功／到達矛盾、不平衡配對總時間，以免產生看似改善的錯誤結論；既有 CSV 向下相容。額外 `correct_entry` 僅供實際觀測，未量測顯示空值。

H17 的需求不確定被現有保守否定 guard 視為 Unknown，而非 Ground Truth 期待的 human_review；這是釐清路由差異，不是錯開案件或承諾可賠。保留失配並列出，沒有降低護欄或修改凍結答案。

沒有發現需要更動 Production runtime 的阻擋缺陷，因此保留原已驗證 Release，不因測試／統計工具更新重啟服務或清空 InMemory 案件。當次 Public Smoke、Demo Browser E2E、資源前後值另存本機原始報告。

## A 的接入與企業界線

產品 API/shared 欄位不變，A 不需為這次評估工具重做介面。受測表可選擇新增 correct_entry 一欄，沿用既有量尺與成功條件；請提供獨立題組及實際匿名紀錄，才可建立真正的泛化／效益證據。

企業系統 Adapter、官方來源治理、SSO、保單／CRM API、文件政策及成本假設沿用 `enterprise-integration-limits.md` 與 `judge2-integration-boundary.md`。原型20次/日最多容納6次三生成流程只是全部成功、沒有其他用量的算術上限；不能說有正式容量SLA或企業部署永遠免費。VPS/網域已購、人力與整合成本未知，不虛構價格或節省百分比。
