# 一般模式 Live 接入修復

## 問題與範圍

先前整合完成的是操作員合成測試模式，不是一般訪客模式。一般訪客沒有操作員 Cookie；測試存摺逾時後整站 AI 又被保護切為 unavailable，因此一般頁面無法分析。本次補上 opt-in 的匿名合成 Session，不修改 A 的 UI／動畫／shared schema。單一模型逾時回 504，不改變整個 Provider 或以 Demo 替代。

## 設定

在已核准的 Free Tier／零成本設定之外，使用：

```ini
AI_MODE=live
ALLOW_PAID_AI=false
AI_PUBLIC_SYNTHETIC=true
AI_DAILY_REQUEST_LIMIT=20
LIVE_AI_REQUEST_LIMIT=20
AI_MAX_CONCURRENT=1
AI_MAX_ATTEMPTS=1
AI_TIMEOUT_MS=10000
AI_SYNTHETIC_DOCUMENT_SHA256=<逐份人工核准合成檔案的 SHA-256，以逗號分隔>
```

額度 Ledger 必須沿用私有持久化檔，不得清除已用次數。Production process 的附加計數器與持久化 Ledger 同樣按太平洋日期換日，避免長期運行後永久卡在第一天的額度。持久化每日上限仍是跨程序／重啟的最終護欄，預先計數，失敗亦計入。

沒有 Free Tier 確認／Key／Ledger 仍 fail closed；未設定 AI_PUBLIC_SYNTHETIC 時維持原有操作員模式。匿名模式不要求將操作員 Token 交給前端。

## A 接入契約

現有同源 fetch 不需改動：首次一般 AI POST 在 Origin 白名單驗證後，自動設定 Secure／HttpOnly／SameSite=Strict 的一小時 Cookie，並在同一請求記錄伺服器 Intent receipt。下一個建立 Journey 請求使用 receipt，不多一次生成。案件仍綁定該 Cookie，其他訪客讀取得到 404；一小時或服務重啟後失效。

新增 optional 狀態 `GET /api/ai/status` 的 `access`：

- `public_synthetic`：一般訪客可直接用合成資料，無須操作員 Token。
- `operator_synthetic`：只開放操作員測試。

原有 status mode／available／syntheticOnly／privacy、所有 Journey API 欄位保留。`available` 代表設定狀態，不保證遠端 API 當下可用或仍有額度。

匿名文件先經 MIME／大小／完整性檢查，再以完整內容 SHA-256 比對伺服器核准清單，通過才將真正 bytes 傳給 Gemini；不根據 documentType 回 fixture。改檔名或聲稱是合成不能繞過指紋。未通過回 422 `SYNTHETIC_DOCUMENT_REQUIRED`，不呼叫模型、不加分。清單空白時禁止全部匿名文件上傳。操作員流程維持原有受控方式。

這是合成資料的公開產品驗收入口，**不是一般民眾真實醫療／銀行文件入口**。A 保留現有原型警示；後續可顯示 Provider／資料處理告知。合成檔下載或其他 UI 接入由 A 決定，本次不重做。

## 失敗與 Demo

- 模型逾時：504 `AI_TIMEOUT`，案件保持原狀，沒有 Demo fallback；不因一次模型失敗自動將全部 API 切成 unavailable。
- 今日用量已滿：429 `AI_DAILY_LIMIT_REACHED`，不付費升級、不假辨識。
- 併發／節流：429 `AI_BUSY`，不自動重送。
- Release 健康／隔離失敗才使用安全回滾；模型單次逾時應保留 Live Provider、記錄請求結果，不把模型 SLA 與程式部署健康混為一談。
- `/demo`、`/embed?mode=demo` 仍是獨立前端本地 Adapter，不碰 Gemini。

## 測試與限制

`apps/api/test/publicLive.test.js` 使用 Mock Transport／測試 Provider，驗證匿名 Cookie、跨 Session 404、同源白名單、合成檔指紋、35→70→90→100、移除撤分、手動不計分、單次逾時後其他請求可用，以及跨日額度。不能把這些測試說成真實模型準確率。

匿名 Cookie 不是保戶身分驗證；Origin 不是完整反機器人防護。Session 數量有界、既有 rate limit 與持久化每日模型上限限制濫用。本地記錄只涵蓋本 API，不能看見 AI Studio 其他使用量。尚未完成真實敏感資料隱私／身分認證／檔案安全驗收，也未做 iOS Safari 實機測試。
