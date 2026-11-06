# NAVI 與 Adrift 共用 Ollama 的發布閘門

## 已核對的現況

2026-11-06（台灣時間）從 LAN 唯讀核對家中 Ubuntu。Ollama 聽在 `127.0.0.1:11434`，Adrift gateway 聽在 `127.0.0.1:11435`。Adrift 的 `src/local-ai/server.js` 提供 `/health`、`/v1/chat`、`/v1/generate` 與依 project/subject 取消。它以既有 `aiCapacity.js` 限制送至自身的工作。Provider 使用 Ollama 原生 `/api/chat`、`/api/generate`、`/api/show`、`/api/version`、`/api/ps`。舊 gateway 明確限制文字訊息欄位，不接受圖片。

| 用途 | 實際標籤 | Ollama digest |
|---|---|---|
| NAVI 文字 | `qwen3:4b-instruct-2507-q4_K_M` | `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0` |
| NAVI 視覺／Adrift 文字 | `qwen3.5:4b-q4_K_M` | `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04` |

`/api/show` 確認文字模型有 completion，視覺模型有 completion、vision。家中 RTX 2060 SUPER 共 8192 MiB，觀測時用 17 MiB，RAM 可用 10434 MiB、swap 用 0 MiB。這是單次空閒觀測，不是推論資源上限。未安裝對照 `qwen3-vl:4b-instruct`，不納入先行發布。

## 共享路徑

```text
Adrift Gateway :11435 ── Adrift broker identity ─┐
                                                 ├─ Broker :11437 ── Ollama :11434
NAVI VPS :21144 ── reverse SSH ── NAVI mTLS :11436 ┘
```

全部 listener 維持 IPv4 loopback。獨立 Broker 讓既有 Adrift 的權限、取消、可觀測性及 API 格式留在原 gateway，也避免放寬該 gateway 的文字驗證器。NAVI mTLS 只信任獨立的 NAVI client CA，Nginx 覆蓋 Authorization 為 NAVI 專用憑證。Adrift transport 只能向 `127.0.0.1:11437` 的既定端點送其獨立 Bearer。不同專案不能讀取其他專案不允許的模型資訊，NAVI 未開放 `/api/ps`、`/api/generate` 或模型管理。

單一 Broker 只有一個生成槽。兩個專案皆排隊時輪替，專案內維持 FIFO。個別限制為每分鐘 admission、同時未完成請求數、allowlist 與資料大小。建議初始 pending 4、RPM 8 每專案，以實機延遲再調整。排隊等候最長 15 秒，端到端上限 65 秒。超出容量或等候逾時回 429，推論逾時回 504。排隊取消會立即移除。運行中斷線會繼續排空原請求，在確認完成及卸載前保有唯一槽位。若送出後遇到無法判斷的中斷，Broker 停止派工並回 503，只有運維人員確認 GPU 安全後才能重啟 Broker。將 `keep_alive` 固定 0 並輪詢 `/api/ps` 至空，無法確認卸載時不放行下一件。實體 VRAM 仍須以 `nvidia-smi` 比對。[Ollama 模型卸載](https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately) · [Ollama running-model API](https://docs.ollama.com/api/ps)

圖片最大 2 張、單張 2 MiB／200 萬像素。驗證 Base64、格式容器、尺寸及非動畫，Ollama 解碼仍可能拒絕損毀影像。NAVI 先執行合成文件原始 bytes 的 SHA-256 白名單、既有 schema 和欄位規則。Broker 不授權文件身分、不判斷保險資格、不存放提示詞、圖片或原始回應。運維日誌僅記錄專案、模型、狀態與耗時。

NAVI 實際生成與評測在送出內容前檢查 mTLS 對端回傳的 `X-NAVI-Inference-Broker: shared-v1`，且生成回應也需有同一標記。標記是已驗證 ingress 的部署契約。還必須在驗收時檢查兩條資料路徑及 raw socket ACL，避免入口配置錯誤。上游不可用時以既有可查證知識檢索降級，Ollama 無 Gemini 或 Demo 生成備援。

## Poppler 驗收與正式變更範圍

已在本機安裝 Poppler 26.10.0，實測文字 PDF、兩頁圖像型 PDF 及 40 份合成資料轉圖。原始 PDF 逾 10 MiB、頁數逾 2、壞檔、未核准雜湊與取消／逾時都需先拒絕。掃描轉圖限制 1200px、輸出大小及命令時間，使用 pipe 傳遞資料。Vision 結果仍待確認，不直接提升 readiness。

新 VPS 唯讀預檢：服務帳號 `navi-hackathon`，`MemoryMax=512 MiB`、`NoNewPrivileges=yes`、`ProtectSystem=strict`，網路限制允許 loopback。已安裝 `qpdf`，缺少三個 Poppler 指令。核准後先在同版本隔離環境確認 `apt-get -s install --no-install-recommends poppler-utils` 的相依及磁碟變更，正式機只安裝該套件，依原 systemd 沙箱以服務帳號驗證工具與合成 PDF，記錄子程序及 API 記憶體峰值。不得以解除 sandbox、放寬執行權限或新增 swap 取得通過。套件安裝本身不需切換 API。若候選應用回滾，先保留不被舊應用使用的套件，待核准再做套件清理。

## 核准後的分段驗收

1. **家中主機窗口**：先記錄服務與檔案原始狀態、確認 Adrift 無活躍工作、Ollama `/api/ps` 為空及 VRAM 回到空閒區間。以獨立帳號與憑證檔啟動 Broker 範本，僅允許 loopback。Broker 使用現有 Zod，無新增 npm 依賴。兩套 Bearer 以獨立 CSPRNG 產生，憑證透過 systemd `LoadCredential` 或 root-only 設定交付。
2. **Adrift 接入**：保留外部 tunnel、原本使用者 token 與 HTTP 端點。以 `adrift-transport.mjs` 的 `adriftBrokerFetch` 接在原 `createOllamaProvider` 的 `fetchImpl`。原 `target:'ollama'` 改明確傳 `baseUrl:'http://127.0.0.1:11437'`，沿用 `allow8k` 與 40 秒 provider deadline，Bearer 從新的獨立私有設定讀取。只在已核准窗口切換既有 gateway，核對其 health、文字、取消與逾時。兩入口就位後用專屬 raw-port ACL 只允許 Broker 帳號連 `11434`，實測 Adrift 及 NAVI ingress 帳號皆不能直連。避免改 Ollama 自身服務設定。
3. **獨立永久通道**：使用 `scripts/ollama/tunnel` 範本，Ubuntu mTLS `11436`、NAVI VPS 反向 loopback `21144`，SSH key 只允許指定 `PermitListen`，不開 session、不接受 agent 或本地轉發。憑證驗證主機 SAN 且與 Adrift CA/identity 分離。用 `verify-tunnel.sh` 驗證 Broker 標記、匿名拒絕、禁止管理；再驗錯誤 CA/SAN、斷線、重連、排隊取消及 Ollama restart。Ollama restart 必須另選安全窗口，並在停止流量和確認無活躍推論後進行。
4. **真實測試**：僅用合成資料。通道測通後先跑 `evaluate.mjs --metadata text`，再依序 `--run text --confirm-synthetic`、`vision40.mjs --run --model qwen3.5:4b-q4_K_M --limit 4 --confirm-synthetic`。第一批通過後改 `--limit 40`。兩支評測都要驗證 Broker，並可由私有 `OLLAMA_BASE_URL` 與 `OLLAMA_TLS_*` 指向隧道。每案記錄 model tag/digest、Prompt/Output tokens、模型 load／generation 時間、總延遲、錯誤與未執行。另從 Ubuntu 對齊 UTC 採樣 `nvidia-smi --query-gpu=timestamp,memory.used,utilization.gpu --format=csv`、`ollama ps`、`free -m`，確認卸載／模型交替與 Adrift 同時送件時不重疊。正式策略每次卸載，分開記錄冷啟動與 OS cache 已熱的後續載入，不能把後者稱為模型常駐延遲。
5. **Staging 及正式窗口**：以隔離 MongoDB、合成帳號做 NAVI API、來源、導航、文件、澄清、多任務、離線與復原 E2E。取得 A 對 #45 的 UI/shared Review 與 A/B 解除交件凍結後，才提交正式窗口。以封存 Release SHA、舊版可相容 MongoDB schema、Broker／Adrift 配置和預估中斷時間作為發布決策依據。

### 停機與回復

本輪未切換，實際停機 0。核准窗口內，預估只有 Adrift gateway 切換及 NAVI API 正式 activate 兩段短暫中斷，秒數待隔離計時。公開網站靜態頁、Atlas 憑證、資料與既有 Adrift tunnel 維持原設定。若 Adrift 相容性或 Broker 排程失敗，先停用 NAVI 的生成，再回復 Adrift 原設定及該專屬 ACL。若 NAVI Release 啟動失敗，使用既有 dedicated manager 的 `--ollama-only` 政策鎖。回至舊可相容 Release 時以 `AI_MODE=unavailable` 保留查詢，移除 Gemini credentials，`ALLOW_PAID_AI=false`。禁止復原舊 Gemini 生成 env。嚴禁不相容的 MongoDB 回退或正式資料寫入測試。

**Go／No-go**：本機 Broker、Adrift 原始碼副本、mTLS 與 PDF 測試已可執行。只有真實雙專案 GPU 並行、Poppler 正式沙箱、永久 mTLS／SSH、隔離 Staging、A Review、正式回滾與新發布窗口都確認後才是 Go。
