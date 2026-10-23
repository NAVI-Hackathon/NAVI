# Release 1.1 — 公開知識日期契約與 A 接入說明

## 範圍與相容性

A 已同意 B 修改 shared／Backend，UI 由 A 接入。本次不改 apps/web 或 apps/mock-site，沒有採用 Release 2 候選內容。正式 Seed、公開 JSON、Source ID、排名與既有導覽錨點不變。

`shared/publicKnowledge.js` 的 forms／faq 使用既有 `date.optional()`；`shared/cardif.js` 保留該欄位；Shared Engine 將逐條日期傳入目的地及來源。投影產生器沿用原本 allowlist，不複製未知欄位。

完整可機器讀取清單：[knowledge-contract-release-1-1.json](knowledge-contract-release-1-1.json)，共97筆既有來源，services18、forms32、faq12、glossary7，其餘為理賠文件與一般規則。每筆含 Source ID、URL、日期、類別、變更狀態、可信 Navigation Destination 與是否需新增 data-tour-id。

**尚無正式採用項目；無需新增導覽錨點。** 所有列出的條目均為unchanged；23項候選另見[逐項審核報告](release2-review-2026-10-23.md)，不可把候選Snapshot ID當成可導航的公開Source ID。

## 日期顯示

| 欄位 | 意義與顯示方式 |
| --- | --- |
| 原始 entry.retrievedAt（optional YYYY-MM-DD） | 該條目的擷取日期；沒有就保持缺值，不能回寫meta.crawled |
| 搜尋結果／KnowledgeSource.retrievedAt | 保留舊契約：有條目日期使用條目日期，否則沿用資料集日期備援 |
| 搜尋結果 dateBasis=entry | 可顯示「擷取日期」；目前8筆（地址服務1＋名詞7） |
| 搜尋結果 dateBasis=legacy_dataset_fallback | 應顯示「資料集整理日期」；目前89筆，不宣稱逐條重新擷取 |
| meta.crawled | 資料集整理日期，仍為2026-10-06；不是官方發布日 |
| publishedAt | 無可驗證值，本次不新增 |

為相容仍開啟舊分頁的strict驗證器，KnowledgeSource回應形狀完全保留，不增加dateBasis。日期來源標記只放在Shared Engine搜尋條目；A可用Source ID查`getKnowledgeEntry(sourceId).dateBasis`，或讀Knowledge Search結果。NavigationTarget內部形狀完全不變，來源日期仍與目的地一致。Backend Knowledge Adapter、來源證據與Navigation Plan沿用Shared Engine；沒有新增endpoint。

A 的 Mock Website SourceNote 已支援逐條日期／資料集日期的不同標籤，forms與FAQ頁也已傳入optional日期。本次無需UI修改。Web主知識搜尋已使用Shared Engine；A 可在來源卡依 `getKnowledgeEntry(source.sourceId).dateBasis` 補上上述標籤。歷史 `apps/web/src/content/cardifData.js` 的本地mock helper仍只讀資料集日期；若A後續要在該備援介面顯示新增逐條日期，需由A接入，B未修改其UI或Mock Adapter。

## 資料安全與測試

- 合成日期只存在測試暫存目錄，不寫入正式Seed；公開投影未新增假日期。
- forms／FAQ各自測試有日期保留、缺值相容、不可能日期／錯誤格式拒絕、private欄位剝除。
- 隔離fixture以實際Browser-compatible模組驗證索引、來源、導覽日期端到端保留。
- 所有97個來源與Backend一致，既有strict來源形狀相容，未知來源欄位拒絕。
- Production Build既有掃描檢查JS、JSON、source maps、Next產物及已知內部筆記編碼，不以畫面沒顯示當成安全證據。
- 所有本地測試與Evaluation禁止外部AI；AI_MODE=demo、ALLOW_PAID_AI=false，未新增相依套件。

## Release 2 閘門

PR #7已合併的是候選資料與審核文件，並非正式採用。23 pending／0 approved；待使用者逐項指定後，才能更新正式知識、逐條日期與必要映射。Release 1.1只部署本契約修正與A最新介面，不部署候選答案。

## 快取相容性回歸

公開瀏覽器曾沿用Release 1的HTML／JS；重新載入後可取得新版。為避免舊客戶端在strict schema遇到新欄位時拒絕整個Journey，本次不向KnowledgeSource追加欄位。`dateBasis`只存在於知識搜尋結果；部署Nginx的HTML入口另外加上no-cache，版本切換後需重新驗證入口。未變更UI。
