# NAVI Ollama 離線實作與開機驗收

這份實作疊在 [Draft #43](https://github.com/NAVI-Hackathon/NAVI/pull/43) 的盤點上。此處的 mTLS 通道取代 #43 中暫擬的明文轉發方式。正式啟用須另行審核。

## 沙箱契約

- 未設定 `AI_PROVIDER` 時仍走既有 Gemini 設定。Ollama 沙箱需要 `AI_PROVIDER=ollama` 與 `AI_MODE=live`，只在本機 loopback 綁定、操作員測試 Session、合成資料條件下啟用。正式環境、持久化產品模式、匿名公開合成模式、代理轉發信任與付費設定均被拒絕。CI 不啟動真實模型傳輸。
- Ollama 實作 `understandIntent`、`understandTasks`、`converse`、`answerKnowledge`、`summarizeHandoff`、`analyzeDocument`。文字與視覺模型有獨立設定，內部沿用既有 Provider 操作介面。這次不新增 Agent 工具。
- 請求僅送到明確的 `http://127.0.0.1:<port>`，使用不跟隨轉址的 HTTP 傳輸。串接採用 `/api/chat`、非串流、指定 JSON Schema、現有 Zod、單一生成槽、有限 FIFO、請求逾時與取消。每次最多一次傳送。沒有 Gemini、付費或 Demo 生成備援。Knowledge 失敗時可回來源原文，交接摘要沿用既有確定性格式。對話 Provider 只接受來源原文與已驗證的來源 ID。
- `/api/ai/status` 在沙箱額外回 `backend: "ollama"`。`X-NAVI-AI-Mode: live` 指執行模式，`available` 指 Provider 已配置，模型健康需以獨立探測驗證。Ollama 的 API 意圖測試走 `POST /api/analyze-intent`；舊 `/api/intelligence/understand` provenance enum 尚無 Ollama，沙箱明確拒絕該路由。A 的 UI 與 shared schema 保持原樣。現有產品對話與持久化路由不在沙箱開放範圍；目前以 Provider Mock 驗證對話操作。
- 視覺沙箱只接收實際 bytes 雜湊符合 `AI_SYNTHETIC_DOCUMENT_SHA256` 的合成 PNG，最多 2 MiB 與 200 萬像素；上傳路由先執行既有 MIME、Magic Bytes 與容器檢查。文件解譯沿用既有 Zod 與 Journey 一致性檢查，保存為 `needs_review` 並標記 `requiresRevalidation`。未知或類型不符的文件沿用既有拒絕邏輯。PNG 白名單授權的是測試輸入，文件真偽、核賠資格、準備度由既有規則決定。
- 正式文件方案仍需驗收。文字型 PDF 應先在隔離程序驗證後抽取文字；掃描 PDF 以頁數、解碼尺寸、CPU、RAM 和時間上限轉成圖片；圖片走視覺模型。逐頁結果須保存欄位來源、檢查前後日期與跨文件矛盾，缺漏與不確定欄位轉人工。只有評測工具會離線轉換已提交且已驗證雜湊的合成 PDF 首頁。

## 離線重現

```sh
node --import ./apps/api/test/networkGuard.js --test apps/api/test/ollama.test.js
node scripts/ollama/evaluate.mjs --dry-run smoke
node scripts/ollama/evaluate.mjs --dry-run text
node scripts/ollama/evaluate.mjs --dry-run vision
node scripts/ollama/evaluate.mjs --prepare vision
bash -n scripts/ollama/tunnel/verify-tunnel.sh
```

`--prepare` 需已安裝 Poppler 的 `pdftoppm`，只驗證本地固定合成資料及影像轉換，輸出原件與派生影像雜湊。PDF 轉換受 Poppler／字型版本影響，兩模型會收到同一次評測中的相同圖片。dry run 與 prepare 均不開網路連線。

## Ubuntu 開機後的驗收順序

1. 查 Ollama 服務、loopback 監聽、版本、磁碟、GPU、RAM 與 Adrift 工作量。核對 Ollama API 只聽 `127.0.0.1:11434`。
2. 先單獨驗證既有 Qwen3.5 4B 的 `/api/show` 中有 `vision`；未取得能力或模型未安裝即停止。Qwen3-VL 4B 需操作者自行批准並安裝後才能比較；腳本無下載機制。三個確切 tag 及本機 digest 都會進入 metadata 報告。
3. 確認無 Adrift 工作並取得生成授權後，先跑合成 smoke，接著才依核准範圍比較。主語言模型為 `qwen3:4b-instruct-2507-q4_K_M`；視覺比較依序為 `qwen3.5:4b`、`qwen3-vl:4b-instruct`。

   ```sh
   node scripts/ollama/evaluate.mjs --metadata vision-baseline
   # 以下命令會真的生成。請先核准對應案例與最大請求數。
   node scripts/ollama/evaluate.mjs --run vision-baseline --confirm-synthetic > ollama-vision-baseline.json
   node scripts/ollama/evaluate.mjs --metadata smoke
   node scripts/ollama/evaluate.mjs --run smoke --confirm-synthetic > ollama-smoke.json
   node scripts/ollama/evaluate.mjs --run text --confirm-synthetic > ollama-text.json
   node scripts/ollama/evaluate.mjs --run vision --confirm-synthetic > ollama-vision.json
   ```

   Vision baseline 為 1 次，可先獨立驗證既有模型。Smoke 為 4 次，含意圖、多任務與兩個視覺模型各一張合成存摺。Text 為 8 次。Vision 為 14 次，包含診斷／住院證明、存摺、缺欄位、空白、風景、模糊及提示注入對照。同一組案例逐一執行、無重試。Smoke 遇任何錯誤即停，較大比較可記錄個別 schema 失敗並執行下一個案例；傳輸失敗、429 或逾時即停，保留未執行項目。先核對待測案例數，避免把 smoke 加進比較題組分母。
4. 同步量測 GPU 與資源，例如另開終端執行 `nvidia-smi --query-gpu=timestamp,index,memory.used,memory.total,utilization.gpu --format=csv,nounits -lms 500`，保留空載基線並對應 JSON 的 `startedAt` 與延遲。記錄模型切換、冷啟動、主機 RAM／swap 及 Adrift 並行影響。本版用 `keep_alive: 0` 讓測試結束後卸載，無法證明兩個模型能同時常駐，也不具備跨應用 GPU 排程。共用前須驗收 Adrift 與 NAVI 共用的排程、硬體利用率與斷線後 GPU 是否釋放；未通過前以分開時段測試。
5. 保存 Git SHA、資料集雜湊、合成素材雜湊、實際模型 tag/digest、全部成功／失敗／未執行案例及原始報告 SHA-256。比較輸出中的欄位 Precision／Recall／F1、錯誤補猜、漏讀、負例誤分類及 p50／p95。欄位分數以有結構化結果的樣本計算，傳輸及 schema 失敗另列；此小樣本不能代表生產正確率。後續補上繁中、合成表單、多頁、跨文件、影像品質與人工確認的正式驗收。

若要啟動 Express 沙箱，應在隔離開發終端以私有方式設定長度至少 32 的 `NAVI_TEST_SESSION_TOKEN`，將 `AI_PROVIDER` 設為 `ollama`、`AI_MODE` 設為 `live`，再執行 `node apps/api/src/server.js`。選擇性設定 `OLLAMA_BASE_URL`（預設 `http://127.0.0.1:11434`）、`OLLAMA_VISION_MODEL`、`OLLAMA_TIMEOUT_MS`（預設 45000）及合成 PNG 指紋。沙箱啟動不探測、不生成。操作員先用 `POST /api/test-sessions` 建立工作階段並安全保存回傳的 Cookie，接著才呼叫 `POST /api/analyze-intent` 或 `POST /api/intelligence/tasks`，均須使用已核准的 Origin。

## Reverse Tunnel 安全閘門

範本在 `scripts/ollama/tunnel/`。目標是 VPS `127.0.0.1:21144` → SSH 反向通道 → Ubuntu `127.0.0.1:11435` mTLS Gateway → Ubuntu `127.0.0.1:11434` Ollama。Ubuntu 專用連線帳號持有獨立 SSH key 與已核對的 host key。VPS 專用帳號限制 remote forwarding 的監聽位置、禁止 session 及本地 forwarding。SSH 伺服器限制的是遠端監聽位置；Ubuntu 端 SSH key 和 service unit 須專屬保護，以控制轉發目的地。mTLS Gateway 使用獨立 CA 與專用憑證，避免把 VPS loopback 當作存取控制。

開機後並取得主機操作授權，再依序驗證：

- 核對服務用戶、金鑰檔權限、host fingerprint 與連接埠。先以 `sshd -t` 和 `sshd -T -C user=navi-ollama-tunnel,host=<host>,addr=<home-ip>` 驗證有效設定。測試拒絕 shell、正向轉發、額外或對外監聽。
- 在 VPS 執行 `bash scripts/ollama/tunnel/verify-tunnel.sh SERVER_CA CLIENT_CERT CLIENT_KEY`。腳本檢查唯一 loopback listener、正確 TLS 身分、無客戶端憑證時拒絕、帶憑證可讀取版本，以及拒絕模型管理路徑。所有探測只讀，生成 0 次。
- 在隔離環境故障注入，驗證 Ubuntu 連線中斷時迅速失敗，連線恢復後可讀取版本，未授權的 VPS 本機程序仍被拒絕。核對不影響 Adrift，並確認新接入服務所需的 systemd 網路規則。
- 後續 staging PR 才接通 Express mTLS 客戶端、產品同意版本及真實 Provider provenance。驗證來源答案、Renderer retrieval-only、導覽、Journey 一致性、MongoDB 相容性、故障復原及前端 E2E 後再進正式切換審核。切換條件包括既有初賽修復合併、保留回滾 Release 和使用者核准。

參考 [Ollama Chat API](https://docs.ollama.com/api/chat)、[Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)、[Vision](https://docs.ollama.com/capabilities/vision)、[OpenSSH sshd_config](https://man.openbsd.org/sshd_config)。
