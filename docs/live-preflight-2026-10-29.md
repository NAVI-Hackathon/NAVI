# 下一輪 Live Evaluation Preflight — 2026-10-29（台灣）

UTC整理時間：2026-10-28T19:08:10.548644+00:00。本輪**沒有生成授權，生成0、模型切換0、付費API0**。修復程式 `dd6cb69585a5f8a6f56e94fd9d9dcd763460b1ae` 尚未部署；正式仍為 `d123b2cf4be185c7d7d8966456fcb93d2de10739`。此計畫不構成生成授權。

## 凍結題組與已知失敗

Dataset SHA：`b4e8215133a3c7b9d3157af152c41eabee3c206d5cef249d95b56740b6d09920`，16 Intent＋12 Document，開發者凍結題組，`independentHeldOut=false`。I21／I22／I23／I25／I29／D21的原文與答案沿用原 `v2/cases.jsonl`，沒有更動、刪除或依輸出改答案。

舊輪2026-10-28T15:39:09.994Z，正式d123b2cf，3.1 Flash Lite，I21真實POST1次得到503 UNAVAILABLE；Provider往返3241.93ms、Service4167.24ms，retry/fallback/paid皆0。保留原始資料與Scorer的0/1服務成功、1/1 API錯誤，不能稱為語意分類錯誤或新版模型準確率；文件樣本0，P/R/F1為null。全v2仍有27題notRun。見 [歷史與原始雜湊](final-live-preflight.md)。新輪不覆寫該紀錄、不自動合併不同Git／Model／Run的分母。

## 可確認的 Gate 與不能推算的數字

| 項目 | 唯讀查得的結果 | 限制 |
|---|---|---|
| 模型 | `gemini-3.1-flash-lite`，線上單一已核准free模型 | 模型清單、available=true僅表示配置；不是成功推論證明 |
| Free Tier | Safari讀取Hackathon顯示Free tier | 執行前仍需核對Key所屬專案、Billing與當時資格 |
| Google面板 | 近一日峰值1/15 RPM、886/250K TPM、1/500 RPD | 延遲可達15分鐘；不是精確剩餘量，也不能當成I21的Token Usage |
| 精確Google剩餘Requests/Tokens | **無法由該頁可靠計算，null** | 不以500−1或250000−886保證可用 |
| NAVI持久化日額度 | 1/20，剩19，Pacific日2026-10-28 | 採樣UTC 2026-10-28T19:04:09.726Z，不是原子預留，執行前重讀 |
| 既有評測Session | 1/6，剩5，未過期 | 不能清零、換Session繞過額度 |
| 並行/重試/逾時 | 1／0／10000ms | 本輪不提高限制、不換Key或模型 |
| Circuit持久化 | 查詢時沒有未過期model_health列 | 不能由此證明Google已恢復或即時queue為空 |

台灣已是10/29，Pacific day仍可能是10/28；不以台灣午夜重設Google/NAVI日用量。保留[官方配額與變動規則](https://ai.google.dev/gemini-api/docs/rate-limits)。[官方503說明](https://ai.google.dev/gemini-api/docs/api-errors)只支持暫時過載/不可用的分類，沒有提供此專案未來健康保證；本輪不發generateContent確認健康，也不改用其他模型。

## 待另外批准的執行選項

- **現有Session可容納的方案：最多5次**，優先尚未執行的I22、I23、I25、I29、D21；I21仍保留舊輪失敗，不從全題組移除。這不是挑成功樣本，尚無任何新輸出。
- 若要求一輪重測六題，現有Session只剩5次，Gate不通過。需先明確批准合法Session/測試安排；本輪不新建、不清零、不提高額度，也不承襲舊輪剩餘五次為新授權。
- 兩種選項都需新的固定生成授權。每次POST、錯誤與重試都計數；提案retry=0、首次錯誤/逾時/拒絕即停，不切模型，不用Demo代答。預計費用為0僅在Free Tier與ALLOW_PAID_AI=false等Gate成立時；否則不執行，沒有付費最壞額度可用。
- 先檢查日/Session餘額、同時執行限制和合成資料同意；舊的root-only擷取目錄已鎖定，不能重新跑舊腳本重用授權或覆寫結果。新輪使用獨立Run ID、輸出目錄、授權檔與原子請求日誌。
- 依序執行，保留原始503與後續所有成功/失敗。每筆保存caseId、固定GT、actual structured output（若有）、model/provider/live_gemini、執行Git SHA、UTC、完整Service與HTTP latency、errorCode、requests、tokens（缺資料null）、isMock/fallback標示。
- D21讀實際凍結PDF bytes及SHA，獨立驗證抽取/欄位/一致性，不因合成白名單或合法JSON直接給verified。模型尊重TEST ONLY而要求確認可記為失敗/拒絕，不能硬改答案。
- 用既有離線 `score.js` 評分；只報當輪已執行分母與完整notRunIds。Intent完整任務集合及類別P/R、文件欄位P/R/F1、錯誤/拒絕/逾時、nearest-rank p50/p95分開。小樣本不宣稱整組v2或真實使用者品質。

本輪Dry Run、Mock28/28與Scorer9/9可重現；這些是管線及評分器驗證，不是模型成績。本輪資料集與Fixture SHA未改；新Live指標仍為待實測，不填假設數字。
