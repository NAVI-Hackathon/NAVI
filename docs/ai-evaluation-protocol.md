# AI 評估：固定題組、評分與授權邊界

本文件是測試工具使用說明，不是模型成效或簡報素材。公開 PR 不包含原始 Live 紀錄、截圖、影片或簡報；它們留在 Git 忽略的 `artifacts/`。

## 題組與證據種類

`apps/api/eval/holdout/` 分開保存 Ground Truth、凍結雜湊與 authored mock outputs。v1 為 22 題 Intent、14 題 Document，涵蓋門診否定、地址、表單、多任務、模糊需求、未知服務、口語錯字、錯誤分院、需求修正與文件對抗案例。

這是**開發者撰寫的前瞻回歸集**。題目在新模型執行前凍結，但作者已閱讀實作；部分文件沿用既有合成媒體。因此 `independentHeldOut=false`，不能稱為未參與調校者提供的盲測。真正獨立題組須由非開發者另外提供、先定義 Ground Truth 與 SHA，再取得執行授權。禁止把同一批題目調校後的成績宣稱為獨立 Holdout。

| 證據 | 定義 | 能證明／不能證明 |
| --- | --- | --- |
| 規則／單元 | 純函式、Schema、Workflow、隔離 | 邊界行為；不能證明模型理解 |
| Mock Transport | 真正 Gemini Provider 注入固定 REST 回應 | bytes 傳輸、正規化及驗證；不能證明視覺抽取或模型準確率 |
| Live Intent | 真實模型生成對照固定答案 | 僅當時模型／版本／樣本；不跨版本推論 |
| Live Document | 真實合成檔案交給模型抽取 | 僅該文件；不是文件真偽或保單資格驗證 |
| Browser E2E | 真實瀏覽器操作 | 網頁、導覽與 Demo 流程；不代表 Live 模型品質 |
| 真人研究 | A 的匿名任務紀錄 | 模擬官網的描述統計；不是正式官網改善率 |

## 指令

```sh
npm run eval:holdout:dry
npm run eval:holdout:mock
npm run eval:holdout:v2:dry
npm run eval:holdout:v2:mock
npm run evidence:demo
```

v2 另凍結 16 題 Intent、12 題 Document（`v2/manifest.json`），包括新生成的 11 份獨立合成媒體；檔案 SHA 固定於 Ground Truth，CI 不重新生成、不使用原開發文件。涵蓋多頁 PDF、PNG、無效 PDF、模糊／空白／無關圖片、缺欄位、日期／病患衝突及只含惡意指令的非文件。醫院與人名為明確虛構英文名稱，帳號僅遮蔽末碼。可選 `generate-fixtures.py` 重製需要既有 reportlab/Pillow；標準測試只讀已提交的 bytes，沒有新增應用依賴。

兩版均由同一開發者撰寫，不能宣稱是未參與開發者提供的獨立盲測。新 v2 僅供評估，未用來更改 Prompt／Workflow；原 v1 Ground Truth、H17 差異與凍結 SHA 均保留。真正外部獨立題組仍需另行提供。

全部離線，不載入 `.env`；新增 runner **沒有 Live 執行選項**，`--live` 會拒絕。沿用 CI network guard、原 Provider、Schema 與業務驗證，不新增 Provider。

未來核准的 Live 紀錄可先清理為下列 envelope，再離線評分：

```sh
node --import ./apps/api/test/networkGuard.js apps/api/eval/holdout/run.js --suite v2 --score artifacts/authorized-observations.json
```

Envelope：`{datasetSha256, observations:[...]}`。每筆 observation 由 `score.js` 的 `ObservationSchema` 驗證，包含 case ID、實際 Provider/model/mode、執行 Git SHA、UTC timestamp、latencyMs、requests（0 或 1）、tokenUsage（無資料為 null）、fallbackUsed=false、errorCode，以及結構化 tasks 或 extraction／documentStatus／issues。只允許清理後的合成資料，不能含 Key、Cookie 或真實文件。這個匯入格式不是產品 API／shared 契約。

評分器保留原始輸入報告 SHA；模式、Git SHA 或模型不同時拒絕合併計算。未執行案例列 `notRunIds`，不假裝失敗或成功；逾時／錯誤列入實際測試分母。沒有樣本時 value=null，不能寫成 100%。匯入欄位本身不能證明真的執行，仍需核對原始 Transport／授權／用量紀錄。

## 指標

- Intent：完整任務集合、outcome 與 Ground Truth 指定的字面欄位子集（例如不可省略不存在分院）的 Correct/Total；各 service 的多標籤 case-level Precision/Recall；組合類別混淆矩陣；Unknown/OOS 處理；Timeout、API Error、p50/p95。
- Document：每個非 null 可觀察欄位的 micro Precision/Recall/F1。多出欄位算 FP，缺值算 FN，值錯算 FP+FN；null 不算抽取成功。模型失敗仍保留預期欄位 FN。
- 文件類型正確率包含有模型請求的失敗樣本；在格式檢查已拒絕、沒有送模型的無效 PDF 不混入分類分母。
- 不完整欄位拒絕率、無關文件 false accept、矛盾處置與 Injection 另列分子／分母。解析合法 JSON 不能視為內容正確。
- 延遲使用 nearest-rank p50/p95；Mock 是本地處理延遲，不能當成 Gemini 速度。confidence 只作現有規則輸入，不當作校準正確率。

工具正常完成也可能含不通過案例；CI 測試驗證評分公式與預期安全行為，不刪除失敗題以提高百分比。凍結 H17 期待 human_review，現有保守否定防線實際回 unknown/clarification；此差異保留，不降低護欄，也不事後改 Ground Truth。

## 下一輪 Live 最小方案：待授權

v2 Dry Run 列出 I21、I22、I23、I25、I29、D21：**最多 6 次實際生成，零重試，首次失敗或逾時停止**。分別檢查住院、否定門診、地址、多意圖、Unknown、一份新合成證明。全 v2 題組上限 27 次（無效 PDF 在 Provider 前拒絕、0 次生成），不在目前單日 20 次規劃內。v1 的 35 次方案保留在原 manifest；不得混算兩版。若只批准少量案例，未執行者列 notRunIds，不把已執行子集宣稱為整組結果。
執行前重新人工核對同一 AI Studio 專案 Free Tier、模型可用配額與延遲資料；另讀 NAVI 持久化 Pacific-day 帳本、Session 餘額、併發與授權總數，取較小值。Production 設定每日20／Session6／併發1／單次10秒／attempt1；預設值12不是線上值，Google 500 RPD 也不是 NAVI 可任意使用的額度。不得提高限制、使用付費備援或以 Demo 補成功。此方案不構成新的生成授權。

## 真人研究整合

沿用 A 的 `docs/usability/protocol.md`、CSV 與 `scripts/usability/summarize.js`。不改 A 的紀錄表或 UI。正式研究只有 A（模擬官網無 NAVI，包含既有搜尋／FAQ／導覽）與 B（同一模擬官網＋NAVI Demo）；沒有第三組比較。

`correct_entry` 為 optional 0/1 欄位，只有主持人實際觀察才填：它區分「有協助但到達正確入口」與 protocol 的未受協助 success。缺欄位不推測到達率／協助後完成率。完成中位時間只計 success；不平衡的配對資料不計 B−A 差異。重複列、非整數指標及矛盾值會拒絕。空表僅回尚無資料，不產生成效數字。

`npm run usability:summary` 可重用；`npm run usability:json` 提供相同分母定義的逐條件／逐任務機讀摘要、原 CSV SHA 與產生時間。尚未收到紀錄時 participantCount=null，不能推斷研究未開始或實際人數為零。新增測試僅使用合成分析樣本，不是受測者紀錄。平均操作步驟和 API 錯誤率尚未在 A 的 CSV 收集，不拿 wrong_clicks 代替。
