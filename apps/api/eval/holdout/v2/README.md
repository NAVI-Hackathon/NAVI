# Evaluation-only synthetic media

這批資料只用於評測，不進入產品 Fixture、公開 Knowledge 或正式文件驗證規則。

- `manifest.json` 記錄事前凍結的案例 SHA；每份媒體 SHA 另存於 `cases.jsonl`，runner 讀取時再次驗證。
- 16 題 Intent、12 題 Document，使用 11 份新媒體；沒有沿用原開發文件。無效 PDF 在格式檢查就拒絕，完整執行最多 27 次模型生成。本工具只提供離線 Mock／Dry Run／已授權紀錄的離線評分。
- 新媒體在任何模型執行前生成；Ground Truth 未因 Mock 結果更改。v1 的題目及已知差異不回寫。
- 作者仍是開發者，不是外部獨立受測者。不能把 authored Mock 通過率視為模型成績，也不能稱為未參與開發者提供的獨立盲測。
- 合成人名、醫院、銀行均明確標為 NAVI EVAL／EVALUATION；帳號只含遮蔽末碼。可讀文件註明 SYNTHETIC／TEST ONLY／NOT A VALID DOCUMENT。Injection PDF 故意只有對抗指令，不是醫療文件。
- 模糊圖與風景圖是程式生成的有限測例，不能代表所有低品質掃描或真實照片。

可選重製：`python3 apps/api/eval/holdout/v2/generate-fixtures.py`。首次生成環境為 Python 3.12.14、reportlab 4.4.9、Pillow 12.3.0；由 pypdf 6.10.0 另行檢查 6 份正常 PDF／1 份預期錯誤 PDF，4 份 PNG 可解析。標準 CI 不安裝這些 Python 套件，只讀固定檔案。跨版本重製 bytes 可能不同；不得直接改凍結 SHA 來掩蓋差異，應另建題組版本。

媒體頁數與可見內容的人工檢查、原始截圖及實測結果留在本機 `artifacts/`，不提交競賽簡報素材。
