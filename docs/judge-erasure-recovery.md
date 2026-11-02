# 刪除後的備份還原防護（候選，未部署）

對應 NAVI-015／018。本輪不執行 Production 還原，不改 Atlas 角色／憑證／Network Access。既有 PR #35 處理 HTTP/Mongo shutdown、Socket、readiness、單次恢復和 StartLimit；本 PR 不複製該套管理器，也不宣稱實際 Ubuntu 回滾已重新通過。

## 根因與實作

原備份有加密及 HMAC，也限制空白目標，但只讀舊 snapshot，沒有排除備份後刪除的 owner／Journey／文件。備份完整性正確不等於刪除語意正確。

本候選沿用 MongoStore、官方 Driver 交易、AES-GCM、HMAC，新增同一 NAVI DB 的 `erasure_tombstones`。不用新資料庫服務或付費依賴：

- 受保護紀錄刪除與 tombstone 在同一個 MongoDB transaction 提交；owner 全部刪除有 owner tombstone。儲存 HMAC tag、scope、revision，不存原始姓名、文件或內容。
- Journey 文件刪除／替換會標記舊 Journey revision。舊備份不能把文件再放回嵌入的 documents 陣列；過舊的 Journey snapshot 會被排除，不能聲稱已恢復該歷程的新版狀態。
- Journey 整件刪除也涵蓋相關 Task、草稿、交接、文件、receipt、批次及對話內的任務副本。僅移除當前關聯，不影響其他有效任務。
- 備份輪替仍約7天；restore 拒絕超過7天的備份。tombstone 保留8天，涵蓋該窗口；TTL不是保證固定秒數刪除，讀取也會過濾過期。
- 啟用時記錄 `schema_migrations.erasureCoverageSince`。這不是補造歷史刪除證據；早於 coverage 起點的備份不能由新工具自動還原。
- 還原必須有來源 DB 匯出的、HMAC 簽章正確、5分鐘內、且不早於備份的 erasure plan。內容包含有效刪除紀錄與當前 usage budgets。缺失、過期、被改動或來源 DB 不符時 fail closed。
- 還原整個 transaction 失敗不回報成功、不留部分寫入。使用新空白 `_restore_<suffix>` NAVI DB；不覆寫正式 DB。
- 不恢復舊登入 Session 或 Auth Token；用量採 plan 的目前高水位，不以舊備份重設配額。還原後需重新登入。
- 原文件不在此資料庫備份長期保存；文件 metadata／抽取欄位仍是個人資料，受相同 owner、加密、到期與刪除控制。

## 管理員恢復流程

1. 需另外授權維護窗口，暫停來源寫入並保持暫停直到驗證完成；不要在本輪 Production 做演練。
2. 在來源私有環境下：`node apps/api/src/storage/admin.js erasure-plan /private/path/erasure.json --source-paused`。僅建立0600新檔，不顯示密鑰。這個旗標是操作員的確認，不是工具已技術證明所有 writer 都停止。
3. 目的環境用只授權獨立 restore DB 的憑證；沿用正確解密 key，但不在聊天／Git／命令列參數放 URI 或 key。
4. 在目的私有環境下：`node apps/api/src/storage/admin.js restore /private/path/backup.jsonl --confirm /private/path/erasure.json`。
5. 只在隔離 DB 驗證：未刪除資料恢復、已刪除資料不出現、owner 隔離、舊 Cookie 失效、當日用量未下降、readiness／來源／草稿一致。驗證前不切流量。
6. 舊備份、erasure plan、加密 key 都需受權限保護；plan 不可公開下載／提交 Git。恢復及金鑰輪替後按政策安全清理。

## 能證明與不能證明

離線測試使用真正的 loopback MongoDB replica set、真交易、真備份及空白 restore DB；Mock Provider 不作真實 AI 證據。包含 record/owner 刪除、Journey 關聯清理、文件從舊嵌入 snapshot 排除、交易失敗不留下 tombstone、新 revision 不被誤刪、missing/tampered/stale plan 的原子拒絕，以及 quota/Session 不倒退。

**限制**：不靠舊 snapshot 自動推知之後發生的刪除。若來源和最新可信 erasure ledger 都已遺失，不能安全恢復舊備份；工具會要求先提供可驗證的最新 plan，不應自行製造空白 plan。需另建異地刪除日誌保存與可驗證的停寫流程，才可宣稱完整災難復原。回滾到不記錄 tombstone 的舊應用也會中斷 coverage，不能沿用舊 coverage 宣稱連續保護；部署審核必須處理這點。這些均未在 Production 演練。

RPO 請量測備份開始/結束UTC、snapshot時點、每筆合成狀態更新與最新 plan時間的落差；RTO 量測「核准開始恢復」至新DB完整驗收及真正可用，不能只量 ping。測試報告中的本機 stopwatch 不是企業 SLA。

MongoDB transaction 的 atomicity 依[官方 Node Driver 說明](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/)；本程式沒有在同一 session 裡平行寫入。帳號readWrite／restore權限分離依[官方角色說明](https://www.mongodb.com/docs/manual/reference/built-in-roles/)準備，本輪不修改實際權限。
