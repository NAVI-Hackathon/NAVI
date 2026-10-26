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
AI_SYNTHETIC_DOCUMENT_SHA256=<既有內建合成檔案的 SHA-256，以逗號分隔；非上傳權限限制>
```

額度 Ledger 必須沿用私有持久化檔，不得清除已用次數。Production process 的附加計數器與持久化 Ledger 同樣按太平洋日期換日，避免長期運行後永久卡在第一天的額度。持久化每日上限仍是跨程序／重啟的最終護欄，預先計數，失敗亦計入。

沒有 Free Tier 確認／Key／Ledger 仍 fail closed；未設定 AI_PUBLIC_SYNTHETIC 時維持原有操作員模式。匿名模式不要求將操作員 Token 交給前端。

## A 接入契約

現有同源 fetch 不需改動：首次一般 AI POST 在 Origin 白名單驗證後，自動設定 Secure／HttpOnly／SameSite=Strict 的一小時 Cookie，並在同一請求記錄伺服器 Intent receipt。下一個建立 Journey 請求使用 receipt，不多一次生成。案件仍綁定該 Cookie，其他訪客讀取得到 404；一小時或服務重啟後失效。

新增 optional 狀態 `GET /api/ai/status` 的 `access`：

- `public_synthetic`：一般訪客可直接用合成資料，無須操作員 Token。
- `operator_synthetic`：只開放操作員測試。

原有 status mode／available／syntheticOnly／privacy、所有 Journey API 欄位保留。`available` 代表設定狀態，不保證遠端 API 當下可用或仍有額度。

2026-10-26 使用者核准開放訪客自行上傳合成文件：設定 `AI_PUBLIC_SYNTHETIC=true` 時，訪客自動取得的案件 Session 可上傳自行製作的合成 PDF／JPEG／PNG／WebP，不需要操作員 Token，也不需要命中內建檔案的 SHA。`documentUpload.builtInSynthetic` 與 `userProvidedSynthetic` 在有效 Session 中均為 true，沒有 Session 時仍為 false；`realPersonalDocuments` 維持 false。既有 hash 環境變數保留解析相容性，不再作為一般文件的權限依據。

文件仍先經 MIME／副檔名／大小／完整性檢查，真正 bytes 送往 Gemini；模型分類、欄位驗證與跨文件一致性決定是否取得準備度。選擇文件類型、檔名、傳入 hash 或成功上傳都不代表 verified。未知／不相關／低信心／錯誤回應不能提高分數，不會改用 Demo fixture。`AI_PUBLIC_SYNTHETIC=false` 時仍需操作員 Session，不能由 request mode、Header 或參數開啟公開功能。

這是合成資料的公開產品驗收入口，**不是一般民眾真實醫療／銀行文件入口**。A 保留現有原型警示；後續可顯示 Provider／資料處理告知。合成檔下載或其他 UI 接入由 A 決定，本次不重做。

## 失敗與 Demo

- 模型逾時：504 `AI_TIMEOUT`，案件保持原狀，沒有 Demo fallback；不因一次模型失敗自動將全部 API 切成 unavailable。
- 今日用量已滿：429 `AI_DAILY_LIMIT_REACHED`，不付費升級、不假辨識。
- 併發／節流：429 `AI_BUSY`，不自動重送。
- Release 健康／隔離失敗才使用安全回滾；模型單次逾時應保留 Live Provider、記錄請求結果，不把模型 SLA 與程式部署健康混為一談。
- `/demo`、`/embed?mode=demo` 仍是獨立前端本地 Adapter，不碰 Gemini。

## 測試與限制

`apps/api/test/publicLive.test.js` 與 `syntheticVerification.test.js` 使用 Mock Transport／測試 Provider，驗證匿名 Cookie、跨 Session 404、同源白名單、自訂合成 PDF／圖片原始 bytes、不同內容的抽取結果、不相關文件不加分、35→70→90→100、移除撤分、手動不計分、單次逾時後其他請求可用，以及跨日額度。不能把這些測試說成真實模型準確率。

匿名 Cookie 不是保戶身分驗證；Origin 不是完整反機器人防護。Session 數量有界、既有 rate limit 與持久化每日模型上限限制濫用。本地記錄只涵蓋本 API，不能看見 AI Studio 其他使用量。尚未完成真實敏感資料隱私／身分認證／檔案安全驗收，也未做 iOS Safari 實機測試。

合成資料是使用限制，不是宣稱系統能在送往 Google 前自動辨別每份文件是否含個資。公開自訂上傳取消了原本的 bytes 白名單，因此必須保留現有「請勿提供真實醫療、銀行或個人資料」告知。Google Free Tier 仍不適合接收這些真實敏感資料；沒有以 Cookie 或勾選同意冒充完整隱私驗收。
