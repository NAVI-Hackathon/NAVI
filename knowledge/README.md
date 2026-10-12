# NAVI Knowledge inventory

| 類別 | 檔案 | 處理方式 |
| --- | --- | --- |
| A：比賽展示 | `cardif.js`、`hospital-documents.json` | 官網本地整理資料的可追溯檢索，以及明確合成的住院／存摺 Demo fixtures |
| A：規則與導覽 | `../shared/cardif.js`、`../shared/hospitalization.js` | 單一 Backend 來源：SEED 驗證、可信目的地、合作院所、需求權重與管道提醒；供 A 接入 API／共享規則 |
| B：Legacy regression | `journeys.json`、`claims.json`、`documents.json`、`faq.json`、`sitemap.json` | 班機延誤的既有測試與明確 Legacy API 保留，仍標記 prototype，不能當法國巴黎人壽展示業務 |
| C：通用技術 | Workflow、Provider、Zod、Repository、來源驗證 | 兩種旅程共用，沿原架構擴充 |
| D：舊定位 | `services.json` 的班機／車禍列表 | 目前無 runtime import；保留歷史資料，不供新 Knowledge 檢索或競賽展示 |

住院展示資料從 `data/cardif_seed_data.json` 讀取；不重新抄寫保險規則、不修改 SEED、不做官方網站 runtime fetch。目前採本地檢索／原文摘錄，不是 Vector RAG。

新住院測試已移轉到 `apps/api/test/hospitalization.test.js` 的完整 server-owned Journey；舊「unsupported 住院預覽」測試改為 supported Journey 測試。班機／車禍 enum、120 個既有本地評估與 fixtures 暫不刪除，以保留相容性。後續若要淘汰 Legacy API，先盤點外部呼叫者、建立版本化替代契約與遷移測試，再刪除；本次沒有直接刪除舊資料或程式。
