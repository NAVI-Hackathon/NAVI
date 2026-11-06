# 營運邊界、最小權限及成本輸入（候選稽核）

本輪不改 Production 設定、Atlas user／role／password／IP Access List。觀測與測試分母、時間、SHA 見本輪驗收報告；沒有新增 Gemini 生成、模型切換、付費服務或正式壓力／回滾演練。

## 最小權限與權限測試

Production 唯讀 connectionStatus 回報 atlasAdmin，這仍是未解決的過大權限。不能從目前 API owner 隔離測試通過，推導資料庫憑證洩漏時也受限；DB角色與HTTP授權是兩層。

本地 `databaseRoleBoundary.test.js` 開啟獨立 loopback MongoDB `--auth`，僅建立合成 bootstrap及readWrite使用者：NAVI DB可createIndex、insert、find；另一DB的find/insert及admin createUser均真的回code13。結束只移除該測試PID和暫存目錄。這是實際本地RBAC，不是Mock，但不是Atlas角色已切換、也不單獨證明Atlas Transaction已在readWrite憑證下驗收。既有owner隔離、CAS及transaction仍用獨立replica set測試。

待使用者明確授權後，由Atlas管理者執行：

1. 新建僅 NAVI DB readWrite、限制 NAVI Cluster 的應用帳號；IP白名單不放寬，勿使用0.0.0.0/0。
2. 新URI存root-only候選env，保留相同DB名稱與資料加密key。先驗證TLS、索引、Transaction、正常API及原有合成帳號/Journey，並以新帳號驗證讀寫非授權DB回Unauthorized。
3. 維護窗口切換應用憑證，重啟前先保留Release/env回滾；核對真正process/readiness，不清空資料或owner。驗證後才撤銷舊應用atlasAdmin憑證。
4. 備份用只讀來源資料的專用憑證；還原用僅授權獨立 `navi_*_restore_<suffix>` DB的短期readWrite憑證。不要擴大應用角色來讀其他DB或還原。應用的維護backup仍受admin endpoint授權，後續可拆成受控工作。
5. API Key／DB密碼以私有env注入、不入Git、不顯示Terminal或PR；切換後驗證新憑證、再撤銷舊憑證。**AES資料加密key不可當DB密碼直接更換**：另需逐筆重加密、備份/刪除ledger簽章key版本及復原驗證；不能造成既有資料不可解密。

[MongoDB官方角色](https://www.mongodb.com/docs/manual/reference/built-in-roles/)定義資料庫權限，不代表第三方保險公司的業務核准。本輪沒有建立或改動Atlas帳號。

## 企業准入責任

| 範圍 | 可核對的核心／目前範圍 | 正式保戶試點所需責任與外部依賴 |
|---|---|---|
| 合成資料沙盒 | Session/owner授權、Backend規則、來源檢索、示範與Live邊界 | 資安負責人核准測試範圍與濫用處理 |
| 真實保戶資料 | 目前不公開接受真實醫療／銀行內容，不能由使用者勾選合成就證明無PII | 企業資料控制者、法遵/隱私責任人確認處理依據、第三方AI條款、保存/刪除及跨境要求 |
| 公開註冊 | SMTP未配置，Production公開註冊關閉；受控測試帳號及既有session另論 | 身分與郵件服務負責人、帳號恢復/反濫用、視需要企業SSO。沒有宣稱SSO已串接 |
| 保單／資格 | NAVI僅準備與導航，不核定資格或金額 | 保險業務責任人提供規則、保單事實、正式API與授權；模型不替代核賠 |
| 官網導覽 | 本地可信source→mock-site router/data-tour-id→iframe origin/request驗證 | 官網團隊維護DOM/Router adapter、CSP/postMessage origin、正式服務入口；不能視為已整合真實法巴官網 |
| 客服接續 | 草稿/預覽/確認/下載，delivery=not_sent | 客服負責人、CRM/工單API權限、同意與送達回執。沒有客服已收到或虛構工單號 |
| 備份/事件 | 加密備份、候選erasure-aware restore、PR35隔離恢復證據 | SRE與資安事件責任人、異地刪除ledger、停寫/備份/恢復演練與事故通報；尚無正式RPO/RTO SLA |

## 可交給 A 的容量／成本算式

以下是工程工作量模型，不是客戶ROI或已量測的人力節省。實際Free Tier可用額度仍需AI Studio當日核對，不能以README當帳單證據。

| 操作 | 請求數假設／已實作行為 |
|---|---|
| 本地Knowledge/Evidence/Navigation/阻擋式澄清 | 0次生成 |
| 正常Conversation或單次Intent | 成功路徑通常1次；每一真正provider attempt都計數 |
| 多意圖拆解 | 一次拆解通常1次，receipt/已保存task建案不應重送；新增追問通常每輪另1次 |
| 住院兩份文件完整流程 | 最小Intent1＋診斷文件1＋存摺1＝3；確認、刪除、readiness與deterministic handoff不用模型 |
| 額外上傳/重分析 | 每份實際分析另1次；相同檔案冪等／失敗是否送出需依原始log判定，不預設重試免費 |
| PDF頁數 | 現行Production檔案上限10MiB、PDF最多20頁；單次多頁可能1次request，但tokens、內容可靠性與延遲不固定，不能將頁數視為免費或線性秒數 |

採樣設定每日20、每Session6、併發1、timeout10秒、attempt1；不代表Google實際剩餘額度或所有請求都會在10秒內成功。Queue等待與整體Service時間要分開，錯誤/逾時也保留；目前沒有新版Live品質/文件F1可填。

假設每天N個住院雙文件流程、每個最少3次，則每日需求3N。純示例：N=5→15次、N=20→60次、N=100→300次。以應用20上限計算，理論上最多floor(20/3)=6個完整最小流程，還沒扣除追問、錯誤、其他使用者與保留額度；**不是可承諾吞吐量，也不修改配額**。

正式費用公式：`Intent輸入/輸出tokens×核准單價 + 文件tokens×核准單價 + VPS固定費 + 備份容量×保存週期×儲存單價 + 知識審核工時×人力單價 + 企業API/法遵/事件處理工時`。單價、頁數tokens分布、人工接續率與企業整合工時目前沒有可靠實測，不填假數字。原型生成零付費不代表VPS或正式企業維運永遠零成本。

人工客服量可用 `任務數×實測需接續比例`，知識維護可用 `變更來源數×逐條審核分鐘/60`；目前沒有A的真實任務研究結論，這兩項比例/分鐘維持未提供，不造改善百分比。A/B仍依 docs/usability/protocol.md 的A（無NAVI）與B（NAVI Demo），不是Gemini品質或正式官網ROI。
