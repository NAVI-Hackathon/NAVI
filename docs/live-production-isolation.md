# Live / Demo 隔離與受控測試契約

本次範圍：Backend、部署工具、測試；不修改聊天室 UI、shared schema 或 Guided Action。已由 A 同意受控 Session / Cookie / 可用性狀態的相容擴充。

## Provider 邊界

- `NODE_ENV=production` 的 `AI_MODE=demo` 會建立 **unavailable** Provider，絕不建立 Demo Provider；舊 `--demo` 參數也不會讓公開 API 回傳 Fixture。
- `AI_MODE=live` 的公開受控模式必須同時具備 Free Tier 人工確認、允許的模型、非 CI、Backend Key、持久化額度路徑、獨立操作員 Token。缺少任一條件即 unavailable。
- Live 失敗只有統一錯誤，沒有 Demo fallback；真實文件由實際 bytes / MIME 經 Gemini 結構化抽取，再由原有 Zod / deterministic 規則驗證。
- `X-NAVI-AI-Mode`: `live | unavailable`（本地開發可為 `demo`），由伺服器 Provider 產生；瀏覽器同名 Header 不影響選擇。
- 文件的 `source=live` / `isMock=false` 只代表抽取來源；`verified` 仍由欄位完整度、信心與一致性規則決定，不代表理賠核准。
- `/demo`、`/embed?mode=demo`、模擬官網 `?navi=demo` 沿用前端 local adapter，不呼叫 Gemini。A 應在 Demo 文件結果顯示「示範辨識資料，非真實文件分析。」

## A 可接入的相容 API

既有 Intent / Journey / Document / Navigation 回應欄位不變，新增：

### GET /api/ai/status

```json
{"mode":"unavailable","available":false,"syntheticOnly":true,"demo":"frontend_local_only","privacy":"黑客松原型，非正式理賠入口。請勿提供真實醫療、銀行或個人資料。"}
```

`available` 表示設定允許 Provider，不代表 Google 當下可用或仍有額度。既有 `/api/health` 維持原有 JSON，額外由 Header 標示實際 Provider。

### POST /api/test-sessions

限操作員受控合成資料測試，**不是一般保戶登入**。

```json
{"token":"獨立的操作員授權碼，非 Gemini Key","syntheticOnly":true}
```

需要核准 `Origin`。成功 201 設定 `__Host-navi-test` Cookie：Secure、HttpOnly、SameSite=Strict、Path=/、1 小時。回應包含合成資料限定、Google Free Tier 資料處理告知及暫存政策。Token 不可放 URL、localStorage、前端環境變數或公開 Git。僅在受控測試介面由操作員輸入；不要把它內建於一般 UI。

同源 fetch 會自動附 Cookie；跨源測試須 `credentials: include` 且 Origin 已列入 `WEB_ORIGINS`。HTTPS iframe 為同一 `navitw.com` site；Safari 是否限制 Cookie 仍需實機驗收。一般使用者無此 Session，不能上傳真實文件或呼叫模型。

- 所有 Intent、Journey 建立、LLM Knowledge Answer 都要求 Session。
- 所有案件讀取、文件、手動資訊、Review、Explanation、Handoff 路由均核對 Session 的案件所有權；其他 Session 得到 404。
- Local Knowledge Search / Evidence / Navigation Plan 仍為純本地公開功能。
- Session / Journey 最長一小時，重啟即失效。原始描述不留存；短期 Intent receipt 使用訊息雜湊、5 分鐘有效，最多 10 筆。
- `/understand` → `/journeys` 可重用同一 Session 的伺服器 receipt，避免第二次模型呼叫。瀏覽器自行提交的 `intentResult` 在 Live 不具決定權；無 receipt 時重新辨識，而不是信任前端欄位。
- 手動資訊仍為 `manual / needs_review`，不增加文件分數。Live 文件與既有手動銀行資料不一致時回 `BANK_INFORMATION_MISMATCH`，保留原案等待確認。

### 錯誤文案與代碼

統一既有 `{success:false,error:{code,message,retryable}}`。

| Code | HTTP | A 的處理 |
|---|---:|---|
| AI_UNAVAILABLE | 503 | AI 暫不可用，提供 Demo 專用入口；不要替換為假辨識成功 |
| TEST_SESSION_REQUIRED / DENIED | 403 | 僅限授權合成測試，禁止上傳真實資料 |
| JOURNEY_NOT_FOUND | 404 | 原 Session 已失效或案件不屬於此 Session，重新開始 |
| AI_TIMEOUT | 504 | 稍後重試或使用 Demo；不自動重送 |
| AI_BUSY | 429 | 有分析進行中或正在節流，稍候手動重試 |
| AI_DAILY_LIMIT_REACHED | 429 | 今日免費次數用完，不升級付費 |
| AI_USAGE_UNAVAILABLE | 503 | 額度無法安全確認，關閉生成 |
| DOCUMENT_TYPE_MISMATCH | 422 | 文件內容與所選類型不同，重新選擇 |
| BANK_INFORMATION_MISMATCH | 422 | 確認既有手動資訊，或由專員協助 |

## 免費與持久化額度

模型仍為核准的 `gemini-3.1-flash-lite`；`ALLOW_PAID_AI=false`。AI Studio 需人工確認同一 Key 專案仍為 Free Tier；環境布林值無法代替計費方案檢查。

- 每日預設 12 次、同時 1 次，5 秒最小間隔；另保留每 process 12 次硬上限。
- 每次實際傳輸前原子鎖定私有 Ledger，計數先落盤才傳輸；失敗與重試也計入。
- 每日以 America/Los_Angeles 換日，跨重啟 / Release 保留。時鐘倒退、記錄損壞、權限不符、鎖殘留都 fail closed；不得刪除記錄來重置額度。
- `.lock` 排他建立、同目錄 temp + fsync + rename，資料夾 0700、檔案 0600；不儲存文字、Key 或文件。
- 429 有 60 秒持久化冷卻；公開 / 受控模式預設單次嘗試，10 秒共同 deadline，不無限 retry。
- 部署路徑例 `/opt/navi-hackathon/run/ai-private/usage.json`，需專用服務帳號擁有目錄；systemd 已允許 NAVI run 目錄寫入。鎖殘留需操作員確認無在途請求後處理，不能自動假定額度未用。
- Google 的專案額度也可能被其他工具消耗，本地 Ledger 無法看見，遇 Google 429 保守停止；不自動啟用 Billing。

參考：[Google 價格與免費資料政策](https://ai.google.dev/gemini-api/docs/pricing)、[專案額度與太平洋時間換日](https://ai.google.dev/gemini-api/docs/rate-limits)。免費服務內容可能用於改善產品，所以此階段禁止真實敏感資料。

## Stage A 實測（2026-10-25）

已在 AI Studio 人工讀取 Hackathon 專案 Free Tier、核對本機 Key 遮蔽尾碼；3.1 Flash Lite 配額列為 15 RPM / 250K TPM / 500 RPD。畫面用量是 28 天峰值，不是今日剩餘額度。

使用者明確核准 4 次，實際恰好 4 次，0 retry / 0 cache / 0 Demo fallback：

| 合成案例 | HTTP | 實測時間 | 結果 |
|---|---:|---:|---|
| NAVI SYNTHETIC HOSPITAL 住院五天 | 200 | 4217 ms | hospitalization_claim |
| 搬家變更保單地址 | 200 | 4134 ms | policy_change |
| 合成住院證明 PDF 的實際內容 | 200 | 8973 ms | diagnosis_certificate / hospitalization_proof，日期計算五天 |
| 合成存摺 PDF 的實際內容 | 200 | 1843 ms | bank_passbook，只保留末四碼 |

同一 server-owned Journey 完成 `35→70→90→100`，Review 無額外生成請求。日期 / 分數 / Workflow 均由 Backend 算。上述時間是本機單次端到端觀察，不代表一般效能、模型準確率或正式站 SLA。負向文件案例使用 Mock Transport 測試，未聲稱已逐項真實 Gemini 驗證。

原始合成結果僅在忽略的 `artifacts/live-isolation/stage-a/report.json`，不含 API Key；未提交原始 Logs。四次預算已耗盡，本次不得繼續 Live 測試。工具 `node apps/api/scripts/stage-live-isolation.js --execute-four` 必須另有明確授權、環境安全設定及合成限定才能執行；不加入 CI。

## 部署與回滾

- Stage A 已通過，Stage B 還需 SSH、實際 HTTPS / Nginx Header、Cookie、資源及受控入口驗收。
- 先部署 unavailable 保護版本並保留前端 Demo。不能把舊一般模式 Demo API 當成安全回滾目標。
- manager 的健康檢查要求實際 mode 為 live 或 unavailable，與 `/ai/status` 相符且 syntheticOnly=true。回滾舊不具隔離能力的 Release 時，只恢復靜態站並停止 API，避免悄悄恢復假辨識。
- systemd 移除硬編碼 `--demo`，由私有環境檔指定 mode。正式切換 Live 前，必須明確調整 NAVI service 的 Google HTTPS 出站限制；不可暗中修改其他服務或全域網路設定。
- 嚴禁舊 VPS；本次只有新 VPS `207.148.113.119`。

## 限制

這是公開黑客松 Prototype，**尚不開放一般民眾真實醫療 / 銀行資料**。Session 是受控操作員防護，不是會員驗證。檔案只在 RAM 暫存、回應後清除可控制的 Buffer，無法保證 Node / V8 / Provider 的每份中間複本立即物理抹除；Provider 留存依 Google 政策。現有容器檢查不是完整防毒 / PDF 解碼；正式敏感資料入口仍需完整隱私法遵與檔案安全方案。未做 iOS Safari 實機測試，交 A 驗收。

## 本次離線驗證與部署狀態

- Baseline：Web 46 / API 162。
- 修改後：Web 46 / API 179，共 225 個 tests；新增 17 個隔離 / 安全 / 持久化測試，含六個獨立 Node worker 的原子額度競爭。
- Dedicated deployment manager：6 個測試。
- Local evaluations：Legacy 120/120、Hospitalization 76/76、Knowledge 111/111，0 生成請求。
- Lint、`typecheck:mock`、`build:all`、Public Bundle 掃描通過；掃描 findings=0。
- 本機 Demo Chromium layout：5/5，含 375/390/430px 與 375x460、390x544 縮短視窗；不等於 iOS Safari 真實鍵盤驗收。
- API / Header 外部只讀檢查：HTTPS health 200、Origin allowlist / OPTIONS 正常、現有線上 `X-NAVI-AI-Mode=demo`。此為舊部署實況，不是本次 Live 成果。
- 2026-10-25 新 VPS 指定金鑰 SSH 回覆 `Permission denied (publickey,password)`，使用者已收到解鎖通知。在 SSH 恢復前**未切換正式站 Provider、未部署本次程式、未量測 VPS 新資源**。
