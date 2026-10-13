# Developer B Phase 4B Report

日期：2026-10-13。開始基準 main：`08aee19`；驗收前已同步 A 更新至 `05a306b`（663c6e7、cc1810a、05a306b）。本次只完成 Hospitalization Intelligence, Validation & Reliability；**Phase 4C 尚未開始**。

## 1. 修改的檔案

- Backend：`schemas/intent.schema.js`、`services/journeyService.js`、`documentService.js`、`documentValidationService.js`、`workflow/journeyStateMachine.js`。
- Provider：`ai/demoProvider.js`、`ai/schemas.js`、`ai/prompts/intentPrompt.js`、`ai/prompts/versions.js`。
- 最小資料遮蔽：新增 `apps/api/src/utils/privacy.js`。
- 驗證：新增 `test/hospitalApi.js`、`hospitalReliability.test.js`、`syntheticImages.js`；`test/networkGuard.js` 增加離線統計。
- 評估：新增 `apps/api/eval/hospitalization/cases.jsonl`、`runner.js`、`cli.js`。
- 指令／文件：root 與 api package.json 新增 eval script，README／architecture 更新目前狀態，本報告新增。
- B 沒有手動修改 `apps/web`、`apps/mock-site`、`shared`、seed、AGENTS、lockfile 或環境檔；未搬移／刪除 Legacy 功能。使用者原有 `docs/phase-2a-report.md` 修改保留，不列入本次提交。

## 2. 新增功能或修復

1. 上傳不只驗證副檔名：沿用 MIME／magic bytes／10 MB 限制，新增基本容器完整性檢查。PDF 須有版本 header 與 EOF；PNG 須有有效長度的 IHDR、IDAT、IEND；JPEG 檢查終止標記；WebP 檢查 RIFF 長度與已知 chunk。
2. 不合法 documentType 在 provider 前拒絕；保留舊 receipt／unknown 流程的 `DOCUMENT_UNRECOGNIZED`、422，而不是新增破壞性的型別要求。格式不完整使用新增的 `DOCUMENT_INVALID`、422、retryable=true。
3. 文件 verified 前再次驗證現有 Zod contract，診斷類需知道 certificateKind；null 子類進 needs_review。
4. Provider intake 接受 `hospitalization_certificate` 這個明確別名，轉為原契約的 `hospitalization_proof`。公共 enum、native JSON Schema 與既有前端資料格式不改名。
5. 一般住院文件可使用住院證明，但醫起通來源明確要求診斷書；只有 verified 診斷書才選醫起通作為完成後下一步。住院證明改引導理賠聯盟鏈／郵寄條件，不推定它適用所有管道。
6. `JOURNEY_NOT_FOUND` 保留 404／retryable=false，文案統一為「這份服務旅程已失效或不存在，請重新開始。」
7. 住院 Intent 及 Journey 使用安全的 Backend 摘要，模型自由文字不能輸出臨床診斷或核准／給付結論；任何 Journey（含 Unknown／Legacy）都不保存原始描述或模型自由摘要，避免未辨識醫療敘述被意外留存；改留簡短服務摘要、必要住院結構化事實。臨床診斷仍回 null；名稱欄位若誤含身分證、聯絡方式、長帳號，轉 null 並交人工確認。
8. Demo 對不合法日曆日期回 null，不再產出會讓正常示範入口出錯的日期；不猜測日期。

## 3. 沿用而未重建的能力

JourneyService、InMemory Repository、Workflow／Readiness／Next Action、Demo／Live Provider、Gemini structured transport、Free Tier guard、deadline／retry、hospital alias、cross-document consistency、來源／導航與 Legacy tests 全部沿用。

上傳完成後重讀 Repository 的並行保護原本已存在，本次增加受控並行 HTTP 測試，沒有新增 queue、transaction framework、DB、Agent 或相依套件。

## 4. Hospitalization Workflow

一般輸入「我上週在台中榮總住院五天，要怎麼申請理賠？」經 Intent → JourneyService → Repository 建立 `hospitalization_claim`，辨識台中榮總及使用者回報五天，合作院所對應臺中榮民總醫院。建立 API 回應時事件與服務已完成，currentStage 為 EVIDENCE_COLLECTION，35%；不是讓模型逐一指定 NEW／INCIDENT_IDENTIFIED／SERVICE_IDENTIFIED。

文件不足或矛盾進 HUMAN_REVIEW；文件完整為 READY_FOR_REVIEW／90%；明確 confirmed=true 且必要資料成立才為 READY_TO_PROCEED／100%。這些狀態不是理賠核准或醫療判斷。

## 5. Readiness 規則與驗收

| 條件 | 權重 |
| --- | ---: |
| 事件資訊 | 20 |
| 服務辨識 | 15 |
| 診斷書／符合此住院情境的住院證明 | 20 |
| 有效住院資訊 | 15 |
| 匯款示範存摺 | 20 |
| 必要資料齊備後確認 | 10 |

驗收 35→70→90→100。確認後刪存摺 →70；刪診斷文件 →55；同類替換不足文件 →55 並進人工確認；重傳有效文件 →90，仍需重新確認。重複／同時上傳不會重複計分或遺失不同類型文件。條件性文件仍 required=false／weight=0。

100% 只代表原型資料準備完成，不代表保障適用、給付日數、核准、已送件或已核付。存摺要求限本原型的匯款示範，不宣稱每案每種管道都必備。

## 6. Document Validation

- 診斷書：必要姓名、院所、已確認子類及有效日期期間／文件明載天數；不完整或低信心 →needs_review。公開 schema 的 diagnosis 保留向下相容，但 Backend 始終清為 null。
- 住院證明：仍屬 diagnosis_certificate 文件類別，certificateKind=hospitalization_proof。別名 hospitalization_certificate 只在 provider 邊界轉換。
- 本地來源 `claim_document_requirements.住院醫療` 明列「診斷書或住院證明」；`claim_hospital_upload.notes` 另寫「仍需向醫院申請開立診斷書」。規則只使用這些本地 snapshot，不擴充保單條款或替代資格。
- 天數沿用 calculateStay：同日 1 天、跨月、跨年、閏年、無效／倒置日期、只有單側日期、明載天數及矛盾皆驗收。daysSource 記 dates／printed_days；user_reported 在事件 context 保留。計算不是可給付日數。
- 存摺：必要 bankName、accountHolder、四位 accountLast4；缺欄位或低信心不 verified。完整帳號欄位被 strict schema 拒絕，誤入名稱的識別碼清為 null。
- 銀行名稱只檢查必要文字與安全結構，不驗證銀行／帳戶真實性；姓名差異是需確認的一致性問題，不判定詐欺。

## 7. Hospital Matching

沿用 shared/hospitalization：台／臺、台中榮總、臺中榮民總醫院、中榮皆可對應；榮總不猜臺北，未列分院不回退總院。埔里分院需單獨存在 seed 名單，部分字串、附近診所、合成非合作院所不當合作。

醫起通合作關係只查 seed，不讓 Gemini 決定。A 的 663c6e7 已修正本地院所與否定辨識，刪除重複 helper、改用 shared；本次保留其成果，一般模式依 Backend claimContext。

## 8. Consistency Tests

驗證文件／原始結構化事件間的病患、戶名、院所、入院日、出院日、住院天數；null 不當矛盾。明確不一致產生原有 issue enum、severity=high、documentIds 與繁中說明，不輸出個資值。文件明載日數與日期不同亦標記。

替換文件後重新計算，不保留已消失的矛盾；原型對差異做人工確認，不拒絕理賠。

## 9. Human Review

缺欄位／未知子類／低信心文件為 needs_review，工作區 nextAction=CONTACT_SPECIALIST；足夠信心的修正文件能恢復 READY_FOR_REVIEW。低信心 Intent 與 unsupported service 沿用既有護欄，不開假的可提交完整旅程。

純知識查詢不能建立已計分的住院案件；POST journeys 對 knowledge_query 回既有 SERVICE_NOT_SUPPORTED、409，不保存假的事件。A 的入口應先處理資訊查詢，不自動建立旅程。

handoff-summary 只使用已知案件資料，不包含病患／戶名原值或完整文件內容。enhance=true 是既有可選 wording；本次未啟用。沒有實際聯絡專員、理賠拒絕或核定功能。

## 10. API Contract Compatibility / Privacy

| Endpoint | 本次驗收 |
| --- | --- |
| POST /api/analyze-intent | 既有中英文、Unknown、低信心、schema 測試保留 |
| POST /api/journeys | 建立住院、unsupported、provider 欄位注入拒絕 |
| GET /api/journeys/:id | schema 可解析、未知／過期／重啟後失效 |
| POST /api/journeys/:id/documents | 真實 multipart →Express→Service→Provider→Repository；四種容器、損壞、錯 MIME／magic、空檔、>10 MB、重複 file、非法類型、惡意 filename |
| DELETE /api/journeys/:id/documents/:documentId | 撤回分數及確認 |
| POST /api/journeys/:id/review | 提早確認被拒絕、必要資料齊才 100% |
| GET /api/journeys/:id/handoff-summary | 已知資料／缺件／矛盾、無自由新增事實 |

主要 Intent envelope、bare Intent、Journey／Document、錯誤 envelope 與公共 enum 不變。新增錯誤 code 是 additive；A 應使用通用錯誤顯示並可針對 DOCUMENT_INVALID 提示重選。

Request／provider／error logs 只記必要 metadata。Repository 不存 bytes，medical filename 固定為 generic 名稱，document raw provider response 不回傳前端。新評估輸出只有 case ID、kind、pass/fail、耗時與彙總；沒有原始醫療輸入。既有 evaluation cache 僅用 curated synthetic cases，正式上傳未接入 cache。

不新增手動文件 endpoint。未來可討論「手動未驗證資訊 →needs_review→使用者確認欄位→專員確認」，不得只因手動輸入就 verified。

## 11. Evaluation Dataset

`apps/api/eval/hospitalization/cases.jsonl` 共 **76 個獨立合成案例**：Intent／否定 15、Hospital Matching 12、Document Validation 20、Consistency 12、Workflow／Security 17。與原 120 題分開，不刪舊題或偷偷將舊樣本替換成住院。

Loader 以 Zod 驗證 curated synthetic 格式及唯一 ID；工作流組使用實際 loopback Express API，不全部只測純函式。並行案例用受控 gate 確保兩次辨識真正重疊；過期／重啟案例使用隔離的 InMemory Repository。

```sh
npm run eval:hospitalization
```

## 12. Evaluation Metrics（2026-10-13 實跑）

| 指標 | 通過／總數 | Pass rate |
| --- | ---: | ---: |
| Intent Classification | 15/15 | 100% |
| Negation Detection | 5/5 | 100% |
| Hospital Matching | 12/12 | 100% |
| Document Validation | 20/20 | 100% |
| Consistency Detection | 12/12 | 100% |
| Workflow Boundary | 17/17 | 100% |
| Unsupported Handling | 10/10 | 100% |
| Mock / Live Boundary | 4/4 | 100% |

總計 **76/76**；指標部分共用案例，不把八項分母相加。全部是 deterministic／Demo／受控注入的期待行為通過率，**不是 Live Gemini Accuracy，也不是實際醫療文件或銀行驗證準確率**。

Gemini Requests=0、Paid API Calls=0、blockedExternalAttempts=0。networkGuard 阻擋非 loopback fetch 並統計；評估會因任何外部嘗試而失敗。安全案例另驗證 CI Live guard 在 transport 前拒絕；原有 Gemini injected-transport 測試保留，沒有真實模型請求。

## 13. Regression Tests

- `npm test`：整合 A 更新後 Frontend **32/32** + Backend **110/110** = **142/142**。B 新增 12 項測試；B 未刪除或改寫任何原測試期待值，A 的院所測試移轉為 shared 規則驗收。
- `npm run eval:ai:local`：**120/120**，原 Legacy 35→70→90→100 保留，requests=0。
- `npm run eval:hospitalization`：**76/76**，住院成功及負向案例全部通過。
- 既有 flight、cost guard、knowledge、navigation、sources、Frontend tests B 未刪除或改寫期待值；A 自己的測試遷移保留在其 commit。

## 14. Build / Lint

- `npm run lint`：通過，exit 0。
- `npm run build:all`：**原專案目錄兩站皆通過，exit 0**，不是只用臨時副本證明。
- Phase 4A 原目錄遇到的 macOS dataless 相依檔案已透過同 lockfile 的 `npm ci --offline` 重建本機 node_modules。安裝 429 packages，lockfile 未改、新增 dependency=0；重裝前停止自己的 dev 程序，Build 時沒有 Next dev 競爭。
- 雙站 HTTP smoke 通過：8 個模擬站路由、assets、Vite API proxy、非官方標示與 API 隔離。Dev 曾遇舊 Turbopack cache 清理錯誤，已將 `.next/dev` 移至 `/tmp` 保留備份後正常啟動；沒有刪除 source。未進行 A 桌面／手機視覺或動畫的新驗收，因本次未改 UI。

## 15–16. Zero-Cost Confirmation

Gemini requests **0**；Paid Dependencies **0 新增**；Paid API calls **0**。沒有執行 dev:live／eval:ai:live、沒有啟用 Billing／雲端資源／搜尋 grounding／付費 OCR 或儲存。ALLOW_PAID_AI=false、Free Tier guard、總 request budget、Demo／Live provider 均保留。npm 安裝使用本地離線快取。

API Key 無法驗證 Billing；本次沒有查帳戶或證明真實住院 Live 品質。將來若需要 Live 驗收，需另提合成資料、請求次數與 Free Tier 限制並取得明確授權。

## 17. Technical Debt / Known Limitations

- 基本容器驗證不是完整解碼、惡意程式掃描、文件真偽、紅章／簽名／帳戶本人驗證；正式公開上傳前需補強。
- InMemory 為單程序、短期 demo；沒有 Auth／多租戶隔離／永久保存／資料刪除稽核，不適合真實醫療銀行資料。測試只用合成資料。
- 同類文件替換是最後完成寫入者為準；不同類並行不遺失，但尚無跨程序交易／客戶端版本控制。
- Scripted Intent／alias guards 不保證自由語言完整覆蓋；76 題不代表 Live 模型泛化能力。
- A 的 main 更新已接入一般模式 server Journey；`/demo` 保留本地備案。B 未修改 A 的 Adapter／UI，只新增用其實際 Adapter 連接 loopback Express 的契約測試。瀏覽器仍保存原始 story 快照，本機展示只用合成內容，正式醫療個資保護尚待額外設計。
- 局部識別碼遮蔽無法保證任意文字中的所有個資；住院原始敘述不保存以降低風險，必要病患／院所 facts 仍短期留於 memory 供一致性檢查。

## 18. Developer A Integration Notes

A 的一般模式 Adapter 已接入，新增 read-only HTTP 契約測試：35→70→90→100、restore/sync、移除與過期清除。

先用 Intent outcome 判斷 supported／preview／clarification／human_review，僅對使用者明確要進行的住院服務建立 Journey。不要因知識查詢自動建立或送件。

既有串接順序：POST journeys →render server Journey →multipart POST documents →render returned journey/readinessChange →DELETE 文件使用回傳 state →POST review confirmed=true →render nextAction／claimContext。前端不要再加分或覆寫 stage。

- 保存 Journey ID 並 GET 恢復；JOURNEY_NOT_FOUND 顯示「重新開始」，不要將 sessionStorage 的舊 100% 當成 server state。
- 所有 Demo 文件保留 isMock；provider=live 或 Intent 來自 API 不等於文件真實辨識。
- certificateKind 保留 hospitalization_proof，住院證明不應直接導航醫起通；以 Backend nextAction／channel notes 為準。
- null、needs_review、未知院所／分院及高 severity 矛盾需顯示確認入口，不直接拒賠。
- 不自動呼叫 handoff enhance=true，不新增手動 verified 路徑；本階段沒有真實專員接續。

## 19. Phase 4C 建議（尚未實作）

依 Phase 4A 計畫對齊本地 Knowledge／Navigation：補 seed 有據的遺漏服務欄位、來源 metadata、A 搜尋 adapter、有效 excerpt／白名單與不足資訊 corpus。維持本地優先、零付費，不導入 Vector DB 或自由生成政策規定。

本次在 Phase 4B 停止，等待確認後才開始 4C。
