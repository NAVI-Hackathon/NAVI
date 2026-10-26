# 受控 AI 文件上傳與合成 PDF 驗證 — 2026-10-26

## 本輪範圍

最新起點 `de092e980b459f2fa7358e68eac0b40d976d5de7`，包含 A 的正式模式合成文件按鈕與 Live 錯誤文案。保留 A 的 UI／動畫／shared schema。

使用者本輪明確選擇「只做離線驗證與部署準備」，因此 **0 Gemini 生成、0 付費 API、未切換／部署公開服務**，不把 Mock Transport 結果當成真實 AI 成功。模型免費配額及真實辨識仍須後續人工確認與授權。SSH已恢復，唯讀盤點結果另列，不代表新版本已切換。

## 文件驗證

直接 import `apps/web/src/mocks/sampleDocuments.js`，執行 `samplePdfFile(type)`、讀取 `File.arrayBuffer()`，取得原始 PDF bytes。Node crypto 與獨立的 Python hashlib 各自計算 SHA-256；不是只比較原始碼字串。前端生成內容與 Backend test fixture 完全相同。

| 文件 | 實際 bytes | 實際 SHA-256 |
|---|---:|---|
| diagnosis_certificate | 800 | aaa742fe89b3c5fc3d913f06dbcd020faa0ef9b878fe530b701040384bb63daa |
| bank_passbook | 746 | 3b1e2154311ef33f2033a7e8e146754baf602751b299901723511d2bc410d68b |

使用 `pypdf.PdfReader(strict=True)` 解析，兩份皆為一頁、未加密、無表單／JavaScript／附件／連結／自動動作；Poppler `pdfinfo` 與 `pdftoppm` 解析、渲染成功，已目視確認文字完整可讀。

住院證明全文：

```text
NAVI SYNTHETIC HOSPITALIZATION PROOF
NOT A VALID MEDICAL DOCUMENT
Hospital: NAVI SYNTHETIC HOSPITAL
Patient: NAVI SYNTHETIC PATIENT
Admission: 2026-10-01
Discharge: 2026-10-05
```

存摺全文：

```text
NAVI SYNTHETIC BANK PASSBOOK
NOT A VALID BANK DOCUMENT
Bank: NAVI SYNTHETIC BANK
Holder: NAVI SYNTHETIC PATIENT
Account: ****1234
```

文字逐行與預期白名單比對，沒有其他隱藏文本、真實姓名／病名／銀行帳號、要求模型忽略指令或偽造結果的文字，也沒有保險公司標誌或官方核發聲明。日期是合成測試資料，帳號僅遮蔽末四碼。

完整本地證據在忽略的 `artifacts/synthetic-verification-20261026/`：PDF、渲染 PNG、generated-byte-report.json、pdf-validation.json、pdfinfo 與測試日誌。

## SHA-256 白名單契約

現有 `AI_SYNTHETIC_DOCUMENT_SHA256` 格式為 **小寫 SHA-256、逗號分隔**，各值 trim；保留現有 parser，不另創格式。

```ini
AI_SYNTHETIC_DOCUMENT_SHA256=aaa742fe89b3c5fc3d913f06dbcd020faa0ef9b878fe530b701040384bb63daa,3b1e2154311ef33f2033a7e8e146754baf602751b299901723511d2bc410d68b
```

只有實際驗證通過後才準備此設定差異，尚未寫入 VPS。更新時保留原有 Key／模型／Origin／Port／Ledger 等設定，禁止整份覆蓋環境檔。

Server 在完成副檔名／MIME／大小／Magic Bytes／容器檢查後，自行對 `upload.bytes` 計算 SHA-256；不接受瀏覽器宣稱的 hash。白名單只辨認內建合成文件，不是所有 Live 上傳的全域限制：

- 匿名公開合成 Session：只能使用已核准的內建文件，修改 bytes 不能冒充原檔；額外 multipart `sha256` 欄位也被拒絕。
- 操作員受控 Session：可上傳其他內容的合成 PDF、JPG／JPEG、PNG、WebP，不要求命中這兩個 SHA。保留原本的操作員授權，不新增假辨識捷徑。
- 真實個人醫療／銀行文件：目前不開放。使用者自行宣稱 `mode`／`operator`／hash／documentType 都不能取得額外權限。

原本操作員其實已可傳入其他文件；本次把授權條件收斂到 Session 本身，補齊可供前端使用的能力回應與實際傳輸測試，沒有重寫 Gemini 或 Workflow。

**命中只代表允許進入測試，不代表辨識成功或 verified。** 新增 Mock Transport 測試證明真正的 inlineData bytes 與前端檔案一致；若回 unknown 則拒絕，低信心或缺欄位則 needs_review／準備度35，不會因命中白名單回 fixture、強制補欄位或增加分數。合成文件上的 NOT A VALID 標示不得移除來誘導成功，也不得繞過人工確認。

## Session 限流與重試

新增 `AI_SESSION_REQUEST_LIMIT`，預設6、允許整數1至20。這是 **AI相關HTTP操作上限，與實際Gemini生成數不同**：

- Intent、建立Journey、文件上傳、Knowledge Answer、enhanced handoff 都計一次。
- 建立Journey即使命中伺服器Intent receipt也計一次；純讀取、Review、手動資訊、刪除文件、Explanation、普通Handoff／Preview／Confirm不計。
- 無效輸入、文件拒絕、生成失敗及客戶端重送也占一次，不退款。正常Golden Path通常四次：Intent＋建立Journey＋兩份文件，保留兩次額外操作。
- 同一Session同步先計數再執行非同步工作，並行不能突破上限；到達上限回429 `AI_SESSION_LIMIT_REACHED`，retryable=false，不呼叫Provider。
- production／受控合成模式的 `AI_MAX_ATTEMPTS` 強制1；設定2會啟動失敗，防止環境設定誤開自動重試。本地歷史evaluation仍可明確測有限retry，與正式服務分離。
- Session最長一小時、重啟即失效；每Session計數存在記憶體，不能取代已持久化的全站每日預算。每日Ledger跨重啟保留、按Pacific day換日，失敗與重試均計入實際傳輸預算。
- 匿名訪客可清除Cookie重新建立Session，因此它不是完整反機器人或會員認證。展示前優先設 `AI_PUBLIC_SYNTHETIC=false`，用受控操作員Session保留評審額度；公開模式仍受既有IP限速及全站每日上限約束。

A 可沿用既有錯誤格式處理新429 code，不需改shared schema或既有endpoint。建議文案：「這個工作階段的 AI 操作次數已用完，請使用示範模式或由工作人員協助。」本次沒有修改A UI。

## 部署準備，禁止直接啟用 Live

尚未完成真實Free Tier／Live文件驗收時，候選設定應為：

```ini
AI_MODE=unavailable
ALLOW_PAID_AI=false
AI_PUBLIC_SYNTHETIC=false
GEMINI_FREE_TIER_CONFIRMED=false
AI_DAILY_REQUEST_LIMIT=20
AI_SESSION_REQUEST_LIMIT=6
AI_MAX_CONCURRENT=1
AI_MAX_ATTEMPTS=1
AI_TIMEOUT_MS=10000
```

以上是 **候選安全狀態**，不是已經寫入VPS的設定。不得清除既有Ledger；不得把人工確認flag改true來代替AI Studio檢查。20是本地額度計畫，仍須低於實際可用免費額度，無法確認則維持unavailable。

後續順序：

1. 新VPS207.148.113.119的SSH已於本輪恢復，唯讀確認 current 為6ec8b82ae0c092b704182caab46262fc1b3b8568；不索取私鑰或密碼。
2. 同步當時最新main，檢查本候選是否已合併以及A是否又有更新；固定通過測試的SHA。
3. 在VPS外建立Vite／Next靜態產物；使用既有隔離Release工具、checksum、Linux安裝的最小API依賴，不複製macOS node_modules。
4. 備份目前環境設定、保留上一Release，逐欄更新設定，核對schema與cookie／Origin／CSP／Header。
5. AI Studio人工確認同一Key專案Free Tier及3.1 Flash Lite可用額度，取得明確生成預算；使用受控Session，先Intent，再兩份已核准PDF，重試也計數，首次逾時停止。
6. 證據要保留真正的模型、Provider、PDF hash、原始結構化輸出（合成資料限定／私有忽略目錄）、Backend Validation、isMock=false、Header及實際Readiness。允許needs_review，不硬改模型結果。
7. 只有安全與真實Live驗收通過才切換一般模式；未通過維持明確AI不可用。Demo入口獨立，不用假結果替代。更新後驗證HTTPS、Nginx、資源與rollback。

本輪不連線舊VPS、不新增Live請求；部署候選與公開切換分開記錄。不得把歷史Live成功／FreeTier確認說成本次結果。


## A 接入契約（向下相容，不改 UI／shared）

既有 `POST /api/test-sessions` 沿用嚴格 body：

```json
{"token":"由工作人員在受控介面提供，不可內建前端","syntheticOnly":true}
```

Origin 必須在 allowlist。成功201以 Secure／HttpOnly／SameSite=Strict Cookie 授權一小時，新增 optional 回應：

```json
{"documentUpload":{"builtInSynthetic":true,"userProvidedSynthetic":true,"realPersonalDocuments":false}}
```

`GET /api/ai/status` 也附同一 `documentUpload`；它依伺服器 Session 計算，沒有操作員授權時 `userProvidedSynthetic=false`。其餘 mode／available／syntheticOnly／access／demo／privacy 欄位保留。

- A 在啟用受控 Session 後，直接沿用現有 `POST /api/journeys/:id/documents` multipart 的 `file`＋optional `documentType`，不新增前端 hash 欄位。請保留同源 Cookie。
- `.pdf`、`.png`、`.jpg`／`.jpeg`、`.webp` 需與宣告 MIME 及實際容器一致，10MB上限。錯誤副檔名回415 `UNSUPPORTED_FILE_TYPE`；損壞／不完整容器回422 `DOCUMENT_INVALID`。
- 相同文件 slot 不代表相同辨識結果。Live Provider 仍以實際 bytes 的 base64 inlineData 呼叫 Gemini，Structured Output／Zod／欄位充分性／一致性／Readiness 皆維持既有後端規則。
- `isMock=false`／`X-NAVI-AI-Mode: live` 表示走 Live Provider，不保證辨識成功；unknown、類型不符、欄位缺漏、低信心、timeout 均不可當成 verified。
- 新429 `AI_SESSION_LIMIT_REACHED` 可沿用錯誤格式。A 應顯示原文與示範入口，不能自動重送／切換fixture。
- 不把操作員 Token 放進公開bundle、URL、localStorage或公開文件。匿名 Cookie 不等於病患身分驗證。

## 隱私與 Provider 政策

2026-10-26 查閱 [Google Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)：免費服務內容及輸出可能用於改善產品，可能由人工審閱，條款要求勿提交敏感、機密或個人資訊。這是維持完全零成本且不得收真實醫療／銀行文件的實際限制；HTTPS或取得匿名Cookie不能解決Provider條款問題。未新增付費替代服務，也未以同意勾選假裝消除限制。

[Google File Input 官方文件](https://ai.google.dev/gemini-api/docs/file-input-methods) 說明inline data逐次傳送與Files API持久化的差異。本專案仍只用inlineData，不使用Files API、外部文件URL或公開暫存連結；不宣稱Google端因此零保留。

原檔僅於處理期間留在記憶體，route finally清除原始request與upload buffer；本次補上parseUpload驗證失敗時清除已建立的bytes。JS FormData／base64／HTTP層暫存副本由GC管理，不能宣稱能保證立即物理抹除所有副本。Repository只保留結構化合成欄位，不保留原檔；不記錄文件、病名、完整帳號或Provider raw body。

## 離線驗收與限制

- 前端46／46、Backend205／205（較本輪起點Backend186新增19），共251／251；未刪除舊測試。
- Layout5／5：375／390／430px及兩種鍵盤縮小視窗；不是iPhone實機驗收。
- Legacy120／120、住院76／76、Knowledge111／111；Competition API E2E通過。
- Lint、`typecheck:mock`通過；root沒有`typecheck`script。
- 任意合法合成PDF、JPEG、PNG、WebP走Mock Transport；兩個PDF內容不同可產生不同欄位；模型unknown／低信心／類型不符／傳輸失敗／文件逾時安全處理。
- 真正Gemini對風景／寵物／空白照片的辨識、NOT A VALID合成PDF的實際判讀尚未執行；one-pixel測試只驗證格式傳輸及拒絕分支，不能當成模型辨識率。
- 基本容器檢查不是完整PDF／圖片解碼或惡意內容掃描，未新增解析器依賴。複雜損壞文件也可能在Provider端失敗，仍必須保持未驗證。此限制和Free Tier資料條款都阻擋公開真實文件intake。
- 受控Session配額加上既有持久化daily ledger、併發1、無自動retry；伺服器重啟不重置每日用量。每日20為已核准計畫，仍需低於AI Studio當時實際免費額度。
- 為保留評審額度，候選建議`AI_PUBLIC_SYNTHETIC=false`，由受控Session使用全站預算；匿名模式可清Cookie重建Session，不是完整反機器人方案。
- 本輪實際生成0、付費API0、新增依賴0；真實回應時間與辨識成果皆未測量。


## 建置、VPS 唯讀盤點與候選發布

- `npm run build:all` 通過，Web及Mock輸出完成公開資料掃描，均0 findings；Mock掃描195個檔案，包含JS／JSON／HTML／source maps。沒有修改公開Knowledge或引入internal_notes。
- 專用VPS部署管理器7／7測試通過。只使用新主機207.148.113.119。
- 2026-10-26唯讀盤點：current為6ec8b82ae0c092b704182caab46262fc1b3b8568；API active、NRestarts=0、cgroup MemoryCurrent 42,487,808 bytes；系統MemAvailable566MiB、Swap使用32MiB、Load0.00／0.02／0.00。這是切換前量測，不是本候選壓測。
- 既有api.env為live／3.1 Flash Lite／daily20／concurrency1／attempts1／public synthetic true；兩個hash已存在。讀取時僅列出安全設定，不輸出Key或操作員Token。沒有修改環境或重置每日Ledger。
- 本次沒有重新確認AI Studio計費專案與模型配額、沒有真實生成授權，故不以Mock測試宣稱Live已驗收。候選可安裝但不啟用，公開current保持既有版本；切換須另行通過合成資料Live驗收及團隊PR流程。
