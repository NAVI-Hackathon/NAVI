# Live Evaluation Preflight — 待授權，未生成

產生時間（UTC）：2026-10-28T15:34:36.825400+00:00；程式／Production SHA：`d123b2cf4be185c7d7d8966456fcb93d2de10739`。

## 凍結與授權

v2：16 題 Intent＋12 題 Document；Dataset SHA-256：`b4e8215133a3c7b9d3157af152c41eabee3c206d5cef249d95b56740b6d09920`。開發者撰寫、執行前凍結，`independentHeldOut=false`，不是非開發者盲測。本輪沒有更動答案、Fixture 或剔除失敗樣本。

最多 6 次真實生成；零重試、零付費、同時 1 次、每次 10 秒；首次錯誤／逾時立即停止，未執行案例保留。不得切換模型或 Demo 湊成功。原有 offline runner **沒有 --live**；它只負責 Dry Run／Mock／匯入評分。核准後的受控擷取需呼叫原 Provider／Services 並沿用持久化用量，不能以新 runner 繞過 Session 與成本限制。

| Case | 類別 | 凍結輸入／文件 | Ground Truth | 上限 |
|---|---|---|---|---:|
| I21 | hospitalization | 這是合成個案：出院通知拿到了，前後住了四天，想把申請理賠的東西準備好。 | `{"tasks": [{"serviceType": "hospitalization_claim", "outcome": "supported"}]}` | 1 |
| I22 | outpatient_negation | 更正，我沒有住院過，只有門診手術，我要找文件說明。 | `{"tasks": [{"serviceType": "unknown", "outcome": "clarification"}]}` | 1 |
| I23 | address | 保單寄到舊家了，新通訊地址要在哪裡登記？ | `{"tasks": [{"serviceType": "policy_change", "outcome": "preview"}]}` | 1 |
| I25 | multiple | 我想換通訊地址，另外我要開始準備住院理賠。 | `{"tasks": [{"serviceType": "policy_change", "outcome": "preview"}, {"serviceType": "hospitalization_claim", "outcome": "supported"}]}` | 1 |
| I29 | unknown | 我忘記今天原本要辦什麼，先等一下。 | `{"tasks": [{"serviceType": "unknown", "outcome": "clarification"}]}` | 1 |
| D21 | diagnosis | diagnosis.pdf | `{"documentType": "diagnosis_certificate", "fields": {"patientName": "NAVI EVAL PERSON A", "hospitalName": "NAVI EVALUATION HOSPITAL", "admissionDate": "2026-08-03", "dischargeDate": "2026-08-06", "certificateKind": "hospitalization_proof", "reportedInpatientDays": null}, "status": "verified", "issues": []}` | 1 |

D21 檔案 SHA：`851be9ae3c619baec56aa4a8ef7a6df3d5394853ca4592bc5fdca4c0ec177e76`。只使用凍結合成 bytes；不混入其他 Journey 的病患／日期作為額外條件。未知欄位不能補猜；`verified` 只是欄位檢查，不是文件真偽或核賠判定。I22 凍結答案仍為 unknown/clarification，即使目前產品可處理門診服務，也不能事後改答案。

## 當前 Gate

- AI Studio Hackathon 顯示 Free tier；3.1 Flash Lite：15 RPM／250K TPM／500 RPD，畫面為近一日峰值、最長延遲 15 分鐘，不能保證剩餘配額。依 [官方限額說明](https://ai.google.dev/gemini-api/docs/rate-limits)執行前重查。
- 真正 VPS Key 對 Models API 的 metadata GET：200，支援 generateContent；GET 1 次，生成 0 次。不是成功推論或文件能力品質測試。
- Production 實測：每日 20、Session 6、併發 1、timeout 10000ms、attempts 1、paid=false；Pacific day 2026-10-28 used=0（2026-10-28T15:27:42.841Z）。不是原子預留，其他使用者可能消耗，執行前再查。
- 已建立私有受控評測 Session，生成用量 0／6，Cookie 留在 root-only VPS config；未對生成授權，尚須合成資料同意。不將 Cookie、Key 或 Token 寫入本文件。
- 真實評測授權仍為 **pending**；本輪生成 0。若只完成 6 題，Intent 分母最多 5，Document 分母最多 1；全 v2 另有 22 題未執行。現在是全 28 題未執行。

## 記錄與評分

每次寫入 case ID、Ground Truth、原始 Structured Output、Backend 正規化／文件驗證結果、Model／Provider／live_gemini、執行 Git SHA、UTC、端到端 latency、errorCode、requests、可取得的 prompt/output Token Usage。無資料為 null，不推算；保留錯誤、429、安全拒絕與逾時。原始報告與個別紀錄保存 SHA-256，清除密鑰／Cookie。用原 `score.js`／`run.js --suite v2 --score` 計算完整任務集合正確率、類別 Precision/Recall、混淆矩陣、文件欄位 P/R/F1、錯誤率與 nearest-rank p50/p95。JSON 合法與模型 confidence 不等於內容正確。

## 已執行的離線檢查

- Dry Run 通過凍結 SHA 與所有文件 bytes 檢查，proposal 為指定六題。
- Mock Transport：28／28；Intent 16／16、Document 型別 11／11（無效 PDF 送模型前拒絕不混入分類分母）；Scorer 測試 9／9。
- 27 次為注入 Transport 呼叫，外部請求 0，不是 Google 模型推論；上述比率不得放入 Live 準確率。
- Raw Mock report：`artifacts/holdout/mock-1793201257304.json`，SHA：`7a7c7a8555565170c9b77ec6d1e316dd7462faf6e7d67ad72f7b4214007af5fe`。完整私有 Preflight：`artifacts/final-live-preflight.json`，SHA：`35cec02e9c303a8f9384e3a4038aef515446061d1b77d39a9712a0e31cc5b396`。
