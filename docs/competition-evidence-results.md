# Competition Evidence — 2026-10-21（台灣時間）

測試版本：`6dc74c644bd9ef77cf341aa4678fea8c697d7788`；基準 `97d0874`。Evidence Pack 在乾淨工作樹上執行；後續文件提交不改產品程式。

重現：Node 22.23.3、macOS arm64，`npm ci && npm run evidence:demo`。本次完整 report、命令 exit code、耗時、輸入題組 SHA-256 與 log SHA-256 的摘要保存在 [JSON](evidence/competition-6dc74c6.json)。完整 log／report／ZIP 在執行機的 `artifacts/demo-evidence/2026-10-20T16-54-01.505Z/`，不提交產物到 source Git。

| 驗證 | 實際結果 |
| --- | --- |
| Frontend tests | 33/33 |
| Backend tests | 151/151（新增 12 組） |
| Lint / 雙站 Build | 全部 exit 0 |
| Legacy local evaluation | 120/120 |
| Hospitalization evaluation | 76/76 |
| Knowledge evaluation | 111/111（新增 4 題受益人變更中英文案例） |
| Local Knowledge Top-1 / Top-3 | 75/75；75/75 |
| 不支援問題／資格拒答 | 11/11；15/15 |
| Navigation evaluation | 85/85 |
| 不合法來源／路徑 | 0/195；0/195 |
| 全索引導航計畫／建置錨點 | 97 份計畫；共 199 次錨點檢查通過（包含 5 個 HTTP 查詢） |
| 合成 HTTP Golden Path | 連續 5 次 35→70→90→100；移除診斷文件後回 55、撤回確認 |
| Browser shared bundle | Vite 打包成功，無 Node builtin 外掛化 |
| 合成 API latency（50 requests） | p50 1.274 ms；p95 7.455 ms |
| Local retrieval latency（101 queries） | p50 0.216 ms；p95 0.535 ms |
| Live Gemini / Paid API / 新付費依賴 | 0 / 0 / 0 |

以上是本地、固定題組、合成資料與 Demo Provider 的結果，**不是 Gemini 準確率、真實文件辨識率、VPS 延遲或真人效益數字**。本次 HTTP E2E 驗證 Backend 及實際 Next 建置錨點，尚不包含 A 新 UI 的瀏覽器點擊驗收。

已證實的差異化：多步驟可驗證導覽；可對帳的每項準備度理由；附來源及擷取日的精確快照摘錄；案件更新即失效、使用者確認後才取得的無敏感欄位摘要。

尚屬商業假說：節省搜尋時間、減少缺件／補件、降低客服量。未做真人比較試驗，不宣稱已節省特定時間、成本或提升轉換率。

完整契約、架構、A 接入方式、安全界線與 HTTPS 評估見 [整合指南](competition-readiness.md)。新 VPS 仍為 HTTP；本次未部署或修改設定，請只用合成資料。
