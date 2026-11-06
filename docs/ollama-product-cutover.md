# NAVI 本地 Ollama 全面取代 Gemini — 產品整合候選（未部署）

> **Draft / 2026-11-06。** 本分支疊在 #44（再疊 #43）之上，尚未重新以最新 main 驗證。本文只記錄已寫入候選程式的能力、限制與驗收條件。**沒有**在家中 RTX 2060 SUPER 上做模型生成、視覺 F1、VRAM、Adrift 並行或 VPS mTLS 實測；沒有執行正式部署、Atlas 更新或 Secret 變更。這份文件不是發布授權。

## 目標：生產模式完全停用 Gemini 生成

- 顯式選擇 `AI_MODE=live`、`AI_PROVIDER=ollama`，`NAVI_PRODUCT_MODE=true`，後端不再要求或呼叫 Gemini API Key。只載入 `createOllamaProvider`；模型失敗後不得回退 Gemini／付費 AI／假 Demo 回應。
- 保留現有 Knowledge/Evidence、Navigation 白名單、Workflow／NBA、MongoDB 旅程與帳號、既有 Zod 契約和前端 `/demo`（明確標示本機合成資料）。
- Text：`qwen3:4b-instruct-2507-q4_K_M`；Vision：`qwen3.5:4b-q4_K_M` 優先驗證，`qwen3-vl:4b-instruct` 作對照。只允許程式中的已審核型號。
- 六項 provider 操作沿用原介面：understandIntent、understandTasks、converse、answerKnowledge、summarizeHandoff、analyzeDocument。輸出仍走既有 schema、Evidence、業務與資格護欄。
- `UnderstandingSchema.meta.source` 新增 `ollama`，前端保存該來源，不再把自架模型標成 Google。這是共用契約與 A 負責 UI 的改動，需由 A Review 並在同一 Release 整合。
- `/api/ai/status` 的 Ollama 欄位在可用時呈 `backend: ollama`；健康探測使用 `/api/version`、2.5 秒內、零推論。離線時回報 unavailable。API/DB Health 不因模型不在線就冒充失敗或生成成功。正式對話的單則回答仍以 `mode: retrieval` 區分可靠來源備援。

## 安全傳輸與啟動前提

**正式站禁止**使用公開 Ollama API 或從 VPS 對家中 `11434` 明文直接連線。本版程式在 production 僅接受 `https://127.0.0.1:<port>`，且必須提供獨立 CA、用戶端憑證、私鑰及驗證用伺服器名稱。傳輸使用 Node HTTPS，`rejectUnauthorized: true`，禁止重導向，拒絕外部 URL、錯誤證書或不安全私鑰權限。TLS 憑證只從絕對路徑讀取（檔案屬於 root 或應用帳號、權限不開放 group/other）。不得把憑證寫入 Git／logs。

規劃中的路徑：VPS `https://127.0.0.1:21144` → 專用 SSH 反向通道 → 家中 mTLS Gateway `127.0.0.1:11435` → Ollama `127.0.0.1:11434`。這些埠只是規劃，**部署前必須檢查實際占用與現有 Adrift Gateway 隔離**。SSH 限制帳號、key、遠端監聽與開啟 session；Nginx Gateway 驗證 mTLS、只開放必要推論與唯讀健康端點。任何一項不滿足即不可切流量。

環境變數示例（此處只展示檔案**路徑**，不包含任何憑證或密碼）：

```dotenv
NODE_ENV=production
AI_MODE=live
AI_PROVIDER=ollama
NAVI_PRODUCT_MODE=true
AI_PUBLIC_SYNTHETIC=true
HOST=127.0.0.1
OLLAMA_BASE_URL=https://127.0.0.1:21144
OLLAMA_TLS_CA_FILE=/etc/navi-private/ollama/ca.pem
OLLAMA_TLS_CERT_FILE=/etc/navi-private/ollama/client.pem
OLLAMA_TLS_KEY_FILE=/etc/navi-private/ollama/client.key
OLLAMA_TLS_SERVER_NAME=navi-inference.internal
OLLAMA_TEXT_MODEL=qwen3:4b-instruct-2507-q4_K_M
OLLAMA_VISION_MODEL=qwen3.5:4b-q4_K_M
AI_MAX_CONCURRENT=1
AI_REQUEST_TIMEOUT_MS=65000
```

尚需沿用正式站原有 `MONGODB_URI`、`MONGODB_DATABASE`、`NAVI_DATA_ENCRYPTION_KEY`、`WEB_ORIGINS`、資料保留／配額／發布環境設定。本例**不是**可直接複製的完整 Production env。不要沿用 `GEMINI_API_KEY` 以提供錯誤備援；候選程式選 Ollama 時不讀取 Gemini Key。舊版 Gemini Provider 程式仍保留以便測試其他分支，不代表 Ollama 失敗時有自動回退。

## 同意、身分與資料安全

正式站要求新的 `disclosureVersion: ollama-local-synthetic-2026-11`；舊 Google 同意不能轉用於新 Provider。用戶在前端先讀 `GET /api/session` 的 `disclosure` 與版本，再確認。UI 不應再連結 Google 條款或將自架模型標為 Gemini。後端對話、Session/owner fence、MongoDB 加密與刪除／恢復規範仍由原 Product Router 掌管。

**仍只允許合成資料。** Vision 必須對上操作員批准的 `AI_SYNTHETIC_DOCUMENT_SHA256` 原件雜湊；文件名稱或前端宣告不是證明。未核准檔案拒絕。此架構未取得真實醫療／金融個資服務的法律、隱私、資安和處理資格，不可改成開放真實病歷。

## PDF／圖片 Vision 流程與限制

新增 `apps/api/src/ai/ollamaDocumentInput.js`：
- 合成 PDF：10 MiB 以下、最多 2 頁，Poppler `pdfinfo`／`pdftotext` 限時、限輸出；有文字層則只送必要的原文字段到 Text 模型，不必先轉圖片。
- 掃描 PDF：每頁經 `pdftoppm` 限解析度轉 PNG，最多 2 頁、每張不超過 2 MiB／200 萬像素；依頁序送 Vision 模型（不允許文件中的提示指令改變系統規則）。
- PNG/JPEG/WebP：先驗證既有容器格式，再檢查尺寸上限與雜湊白名單；未知或巨大影像 fail closed。影像與文字分別選擇已授權模型。
- PDF 系統工具缺少、格式不完整、輸出超限、逾時或模型離線時，回明確錯誤；**不呼叫 Gemini**。系統仍可提供可信 Knowledge、人工資訊輸入或明確 Demo。
- Model 輸出經 Zod/一致性檢查，文件標 `needs_review`／`requiresRevalidation`。**暫不讓未校準的視覺結果直接增加 readiness 或宣稱文件驗證／資格通過**。要保持正式 Journey 35→70→90→100 的完整真實上傳體驗，仍需後續受控實測及驗收。

本輪沒有實測 Poppler 在正式 VPS 的可用性與記憶體／CPU；正式環境可能有 systemd sandbox、外部程序限制，需另行驗證。Vision 指標及弱欄位拒絕門檻必須基於實測，不得由模型自報 confidence 取代。

## 四十份純合成文件評測（不含實測分數）

`scripts/ollama/vision40.mjs` 使用 Node 內建程式產生 40 份**非真實** PDF：10 份完整醫療證明、10 份合成存摺、10 份缺日期證明、10 份無關負例。附固定 Gold Fields、PDF SHA-256；正式比較將其 rasterize 為相同 PNG，逐次送單一視覺模型，計算 micro Precision／Recall／F1、漏讀、補猜、文件類型正確率、p50/p95、傳輸／Schema 失敗及未執行數目。請補入繁體中文、多頁、模糊、不同排版、注入與跨文件矛盾案例；此 40 份僅是基礎測試，不是臨床／金融文件代表性抽樣。

```bash
# 預設只看計畫：零模型生成
node scripts/ollama/vision40.mjs --dry-run

# 待 Ubuntu 啟動、確認沒有 Adrift 工作量、獲取批准後才跑
node scripts/ollama/vision40.mjs --run --model qwen3.5:4b-q4_K_M --limit 4 --confirm-synthetic
# 若模型已安裝且通過模型能力核對，再跑比較：
node scripts/ollama/vision40.mjs --run --model qwen3-vl:4b-instruct --limit 4 --confirm-synthetic
```

評測腳本不下載模型。預設不進行任何真實生成，`--run` 必須指定模型、數量及確認旗標。完整比較 40×2＝80 次生成，務必分次授權和監控 GPU。VRAM 由另一終端 `nvidia-smi` 逐次記錄；沒有任何已測出的 F1／VRAM 數值。

## 8 GiB GPU／Adrift 互不干擾門檻

NAVI Provider 只允許單一生成槽與有限等待佇列，每次 `keep_alive:0` 釋放模型。**這不是** NAVI 與 Adrift 共用的全域 GPU 排程，也不證明 Ollama 已卸載所有 VRAM。正式切換前必須新增／驗證跨服務的排程、GPU 資源上限、優先權與故障恢復；不能靠兩個應用各自單執行就聲稱不會衝突。驗證 NVIDIA GPU 顯示實際模型載入／卸載，測量冷啟動、首 Token、整體 p50/p95、CPU/RAM/swap、模型切換與 Adrift 端到端延遲。

## 尚未完成的正式發布閘門

1. **把 #43 → #44 → 本 PR 的實作重新對齊最新 main**；處理與 #33–#42／A 的 UI、shared 契約衝突，通知 A Review shared 與 apps/web。
2. 在可用的 Git working tree 執行單元、API＋MongoDB、Product Browser、Chromium/Android/WebKit、Lint、Typecheck、雙站 Build、公開資產掃描，保留首次失敗與重跑紀錄。**本次遠端修改只做靜態語法審查，不宣稱跑過上述測試。**
3. 家中 Ubuntu 開機後，確認 `ollama list`、`/api/show` capability、CUDA VRAM、Poppler，先試已下載 Qwen3.5 4B，再比較 Qwen3-VL 4B。
4. 真正評測文字任務、澄清、E13、文件欄位、官方來源引用、Agent/Workflow 導覽護欄、MongoDB 讀回、權限隔離；證據包含版本、模型 digest、正確率／延遲和負例。
5. 在獨立安全窗口配置 mTLS、SSH Tunnel、VPS systemd networking。實測未授權連線失敗，已有 Adrift 不中斷；不在未經授權情況修改 VPS／Atlas。
6. Staging 的 Ollama Offline／Reconnect 測試、故障下降到 retrieval-only 而不白屏／無 Gemini 備援；正式部署之前完成資料刪除/回滾相容性。
7. 使用者另行核准正式 Release 和回滾閘門。舊版的 fallback 如需使用，是操作員明確回滾整個 Release，而非 Ollama failure 時自動呼叫 Gemini；若最終要求完全零 Google 生成，回滾也應切至 `AI_MODE=unavailable`＋可信檢索。

**驗收前不得宣稱「Gemini 已在 Production 完全被取代」。**

## 2026-11-06 整合與實機預檢

已將候選整合至 main `24dde2b8dcfda7634c8ccb37ac901b11224325a6`。家中 Ollama 0.40.13 在 RTX 2060 SUPER 8 GiB 主機運行，已安裝的精確標籤為 `qwen3.5:4b-q4_K_M`，`/api/show` 回報 Vision；文字模型 `qwen3:4b-instruct-2507-q4_K_M` 回報 completion。

暫時驗收通道透過 SSH 從 VPS loopback 經操作機轉至家中獨立 mTLS 測試端點。實測憑證身分、拒絕匿名、拒絕模型管理和生成、兩個模型 metadata、關閉反向監聽。使用後已清理暫時 listener 與憑證。這項檢查的生成次數為零。

Adrift 使用家中 `11435`，自身閘道的排程只覆蓋進入該閘道的請求，並拒絕 image message 欄位。正式 NAVI 需另立通道及可共用的推論容量管制，或使用獨立推論資源；在此之前停止真實生成與 Production 切換。正式發布仍須取得 A、B 對新窗口的同意。

既有 dedicated manager 新增 `activate <release> --environment <private-env> --ollama-only`。通過正式驗收後才使用；它會鎖定日後發布的本地 AI 政策。初次切換失敗或回到舊程式時，回復環境移除 Gemini 金鑰、關閉付費並將生成設為 unavailable。Ollama 產品請求沿用既有 MongoDB 每日配額與 Session 限流。舊嚴格意圖客戶端以既有 `X-NAVI-Contract: judge-v1` opt-in 區分新版 provenance。
