# Live Evidence Matrix — 第二位評審

> 2026-10-27 更新：A 已開始 A/B 研究與 iPhone 複驗，但本機尚未收到原始紀錄；以下歷史階段的「未實施」不能當成當前研究狀態。新一輪 6 次最小評測方案以 `ai-evaluation-protocol.md` 的 v2 Dry Run 為準；舊 5 次提案保留為歷史，沒有任何提案自行取得 Live 授權。

歷史紀錄只代表當時版本的合成測試，不能當成目前 main 的模型準確率。原始 API/瀏覽器紀錄保留本機、不推送公開 GitHub；以下SHA可與本機原始報告核對。本輪新Live生成為0。

| 證據 | Git SHA | UTC執行時間 | 定義與結果 | 原始報告 SHA-256 |
|---|---|---|---|---|
| `artifacts/live-gemini/first-api-response.json` | `未記錄，provenance不完整` | 2026-10-24T12:17:15.172Z | 真實API回429；生成是否已抵達模型無法由此報告確定，不能列成功樣本 | `bab46a257be95aa897b49b365ff8cfeda75283a7c7b6dda0065a5e99a21c1a38` |
| `artifacts/live-isolation/stage-a/report.json` | `未記錄，provenance不完整` | 2026-10-25T07:18:13.682Z | 4次真實生成：住院／地址Intent＋兩份合成文件；當次成功，但缺Git SHA，不併入當前準確率 | `f17c80f4bc70d4f2e28f0e56776cd63a306dc552e5db46e4fcb0f399b11a7049` |
| `artifacts/live-isolation/deployment/vps-live-report-attempt-1.json` | `ad85e0a55a1b60f9d6b47b74ba12dae4316dc1bf` | 2026-10-25T08:21:48.138Z | 真實Intent後AI_BUSY；1次生成，流程未完成 | `24a133d777110abbf7651b6a02d0c53d9f567f3a0983db9fe14e9e6be503f36e` |
| `artifacts/live-isolation/deployment/vps-live-report.json` | `ad85e0a55a1b60f9d6b47b74ba12dae4316dc1bf` | 2026-10-25T11:24:48.891Z | 3次真實生成；流程止於35→70，VALIDATION_FAILED，非成功Golden Path | `7652a6ba07b89a5aed185f28ac4ad8c3d574ea5981b4ccb404f7778f2cecb766` |
| `artifacts/pr16-production/release-report.json` | `e2a6100ecd88cebf4a714fe93368c194bf0cd22c` | 2026-10-26T20:49:48.999394+08:00 | 3次真實生成均成功（Intent2215ms／診斷3070ms／存摺2172ms）；屬歷史版本，不是當前回歸準確率 | `e661af540e6826cb950c030d71c16028502bd8cb1c825f8b5fdb6d0ee61fd267` |
| `artifacts/pr16-production/live-usage.json` | `未記錄，provenance不完整` | 未記錄 | 同上一列的3次請求帳本，不是另外3次樣本，禁止重複計數 | `9975790760f941345ae497ecec8834eb59fff332f6d87b3eb3568594ac787294` |

## 本輪證據種類與範圍

| 類別 | 真正量測的事物 | 本輪狀態 |
|---|---|---|
| 單元／規則 | 確定性條件、扣分、隔離、來源、手動資訊 | npm test，依固定發布Commit的報告記數 |
| Mock Transport | 原始bytes／結構化輸出／錯誤處理，回應由測試指定 | 原27題與judge2新增11題分開報告，不是模型準確率 |
| 真實Gemini Intent | Google生成結果與正確答案比較 | 本輪未執行；歷史見上表，缺資料不補寫 |
| 真實Gemini文件抽取 | 實際合成文件內容、抽取與Backend驗證 | 本輪未執行；不把像素傳輸測試當視覺品質證據 |
| 真實Browser E2E | 實際瀏覽器、公開路由、DOM高亮、Demo操作 | 本輪部署後報告；Demo不證明Live模型品質 |
| 真實使用者 | 非開發者做任務、完成時間／正確目標／協助 | A 已開始研究；尚未收到原始紀錄，不推論實際人數與結果 |

現存120 Legacy、76住院、134 Knowledge題組定義不同，不能合併成模型準確率。歷史96/96、111/111若無對應原始報告／SHA則視為歷史未核對主張，不拿來替代最新結果。

## 新測試題組與授權

`apps/api/eval/reliability/judge2-cases.jsonl` 是B在舊實作凍結後新增的開發者回歸題，**不是未參與開發者提供的獨立題組**；已向使用者索取獨立合成題組，未收到前標記待提供。覆蓋否定住院、混合意圖、模糊表達、未知服務、錯誤醫院分院與文字Prompt Injection。

無關／空白／模糊／傾斜圖片、多頁PDF、資料矛盾與文件Prompt Injection，沿用 `apps/api/test/documentAdversarial.test.js` 與 `syntheticVerification.test.js` 的固定合成fixtures；只證明傳輸與Backend驗證，不宣稱Gemini真能辨認這些檔案。

本輪允許離線準備。新的真實驗收須另行核准：先核對AI Studio同一專案Free Tier、模型與剩餘配額，再批准不重試的固定請求預算；可先依 `ai-live-evaluation-plan.md` 的5次最小區分題組執行。文件擴充測試另列預算，不能自動加進那5次。任何失敗/逾時都保留並停止，無Demo替代。

## 可重現報告

`npm run evidence:demo` 沿用既有 runner，現在涵蓋新題組／navigation／typecheck／layout。`report.json` 包含執行Git SHA、dirty狀態、資料集SHA、每個指令原始log SHA與時間；原始log跟在同一個本機資料夾。`eval:reliability:local` 與 `eval:judge2:local` 各自輸出dataset SHA、Git SHA、dirty/diff、實際輸出、Ground Truth、延遲及0Live請求。沒有跨資料集混用分母。
