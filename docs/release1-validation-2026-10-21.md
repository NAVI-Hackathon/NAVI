# Release 1 公開驗收與 Knowledge Refresh

## 已完成：公開 Release 1

- 主程式／最新 main：`64ceb17b05d9b90b4edc95a2f737707bde8f4d88`。
- 安全修正：[PR #6](https://github.com/NAVI-Hackathon/NAVI/pull/6)，合併 `249797f`。隨後納入 A 的 `448321b` 逐條日期標示、`64ceb17` 可信來源展開。沒有重做 A 的 UI。
- 最終啟用：2026-10-21，VPS 紀錄驗收時間 `2026-10-21T11:11:48.811749+00:00`（台灣 19:11）。
- current：`/opt/navi-hackathon/releases/64ceb17b05d9-1792580773`。
- previous：`/opt/navi-hackathon/releases/448321b7a778-1792580188`，保留可回復的已清理版本。
- 封包 SHA-256：`c7d06f335c1edd16520a90711c329d6225e854b3b50e1ec662eed42436bdb35b`。
- 環境：Ubuntu 24.04.5、Node22.23.3；Mac 建置靜態雙站，Ubuntu 安裝 74 個 API production dependencies；沒有複製 Mac node_modules，也沒有在 VPS 執行 Next Build。

| 用途 | 公開網址 |
| --- | --- |
| 模擬官網／嵌入式 NAVI | http://207.148.113.119/ |
| NAVI | http://207.148.113.119:8080/ |
| Health | http://207.148.113.119:8080/api/health |
| 本地備援 | http://207.148.113.119:8080/demo |

只連線新 VPS。沒有接觸舊 VPS，沒有調整 Nginx／systemd／防火牆／Swap 等全域設定。沿用專用 manager 安裝、驗證並原子切換 current；部署未失敗，沒有執行緊急 rollback。重啟 API 會清空 InMemory 案件，舊案件失效時介面能引導重新開始。

### 測試與證據

完整數據：[機器可讀驗收記錄](release1-validation-2026-10-21.json)。

| 項目 | 實際結果 |
| --- | --- |
| 應用 tests | Web41/41、Backend154/154，共195/195 |
| 爬蟲 tests | 19/19，包含 PDF redirect／binary header、robots、重試、抓取／抽取失敗不刪舊資料、段落 ID／順序／數字／否定詞 |
| 專用部署 manager／builder tests | 4/4、2/2 |
| Lint／typecheck:mock／雙站 Build | 通過；實際 static export 另行掃描 |
| Legacy／Hospitalization／Knowledge eval | 120/120、76/76、111/111 |
| Source／Navigation E2E | 97 個 canonical plans、199 個建置錨點，5 次住院 Golden Path |
| 外部 HTTP | 37/37 checks，23 個 API requests，p50 57.39ms／p95 143.43ms |
| 真實公開資產 | 88 個／2,908,481 bytes，逐檔 HTTP 下載、與封包 SHA 比對、私有欄位／指紋 0 命中 |

`evidence:demo` 最終完整報告是工作分支 `7b87833` 的 clean run；已用 Git diff 確認它與部署 SHA `64ceb17` 的 apps、shared、knowledge、Seed、package／lockfile 完全相同，只多候選擷取與爬蟲工具。Production Builder 另外從精確 `64ceb17` 的新 git archive 建置，沒有把候選資料包入 Release 1。Typecheck 與 Python tests 分開執行。不存在 root `eval`／`typecheck` script，使用 package.json 真實名稱，不執行 Live eval。

實際瀏覽器驗收：

- Desktop 正式模式建立住院案件，範例診斷書／存摺、確認，35→70→90→100；健檢區及決定性計分理由正常。
- Handoff 遮蔽預覽→明確確認→「已取得摘要・尚未送出」，沒有聯絡真人或提交理賠。stale／重播防護、manual needs_review 不計分、刪除撤回由外部 API 檢查覆蓋。
- 390px 實際 Embed 地址查詢、跨頁「帶我去」、高亮、回到 NAVI、逐步導覽；新版來源展開顯示日期與原文，明示非即時查核。
- `/demo`、`/embed` 外部 HTTP200；備援 Adapter tests 通過。本輪未再次停止正式 API 做破壞性離線演練，先前紀錄不能冒充本輪新測量。
- 400／403／415、安全來源與 URL injection 拒絕、門診與住院區分通過。

### Public Knowledge Sanitization

詳見 [安全修正原因與歷史範圍](release-knowledge-refresh-2026-10-21.md)。Browser 的三個資料入口只 import 生成的 `cardif_public_data.json`；公開欄位白名單與 build-time fail-closed 掃描檢查 JS、JSON、Source Maps、RSC／static export。原始 Seed 也移出 7 組開發 metadata，備份只留在 ignored、0700／0600 的本地 `data/private/`。

舊版真實公開 Bundle 已確認包含開發 metadata；掃描過的 Seed 歷史版本沒有辨識出真實個資或金鑰，但不是全 Repo Secret Audit。Git 歷史與使用者已下載快取沒有被抹除。歷史未清理 Release 不應重新公開；目前 previous 是已清理版。

### VPS 短期取樣

| 指標 | 更新前 | 最終版操作後 |
| --- | ---: | ---: |
| Express RSS | 89.22 MiB | 87.91 MiB |
| Nginx RSS 合計 | 8.66 MiB | 8.54 MiB |
| MemAvailable | 552.10 MiB | 549.89 MiB |
| Swap 使用 | 19.61 MiB | 19.61 MiB |
| Load 1/5/15 | 0.00/0.00/0.00 | 0.08/0.03/0.01 |
| OOM kill／非預期重啟 | 0／0 | 0／0 |

API PID47771、cgroup high／max／oom 事件均0。這是合成展示短期取樣，非長期壓測或 SLA。AI_MODE=demo、ALLOW_PAID_AI=false，VPS 沒有 Gemini Key；Live Gemini、付費 API、新增付費依賴均0。

## 已完成：本地定向擷取與待審核差異

- 使用既有 `cardif_crawler.py` 的 robots／可信主機／重新導向／大小限制，新增 `targeted_review.py` 做固定 inventory、原始與正規化 SHA-256、逐段 Diff、審核清單。
- robots.txt HTTP200，`User-Agent: * / Disallow:` 為空；不代表已做完整法律授權審查。只讀公開 HTML，不進登入、第三方 FAQ、驗證碼或整站探索。
- 原始 capture：`data/crawl/capture-2026-10-21/`；最終候選：`data/crawl/candidate-2026-10-21/`。舊 `review-2026-10-20/` 完整保留。
- 最後一步只離線重建衍生資料，沒有第二次擷取。移除已知裝飾 icon／portlet ID／通用頁面標題／麵包屑，保留數字、否定詞、表格、條件與順序；有語意的圖片連結不會任意刪除，也沒有 OCR。
- 實際擷取於 `2026-10-21T11:00:16+00:00` 至 `11:00:49+00:00`，8/8成功。每次網路請求間隔至少1.5秒，PDF只存標題與連結，不下載。
- 原7頁正規化內容一致，raw HTML hash不同不能直接視為保險規則改變。
- 最終：Added22、Modified0、Removed0、Unchanged662、Fetch Failed0、Extraction Failed0、Requires Manual Review1。**23項 pending、0 approved、0 adopted**。初次 capture 的衍生清單保留作過程紀錄，人工審核以 `candidate-2026-10-21/review-checklist.json` 為準。

| 公開頁面 | 實際 URL |
| --- | --- |
| 保單變更／地址／受益人 | https://life.cardif.com.tw/zh/a312 |
| 理賠／門診與住院文件 | https://life.cardif.com.tw/zh/a314 |
| 保單借款 | https://life.cardif.com.tw/zh/a313 |
| 常用表單 | https://life.cardif.com.tw/zh/a311 |
| 網路保險服務 | https://life.cardif.com.tw/zh/f8 |
| 名詞解釋 | https://life.cardif.com.tw/insurancedictionary |
| 既有表單入口 | https://life.cardif.com.tw/zh/a3 |
| 已驗證官方連結的 Q&A | https://life.cardif.com.tw/zh/a319 |

[Markdown逐段報告](knowledge-crawl-diff-2026-10-21.md)／[JSON完整報告](knowledge-crawl-diff-2026-10-21.json)／[可逐筆選擇的審核清單](../data/crawl/candidate-2026-10-21/review-checklist.json)。JSON含兩版文字與SHA、來源ID／URL、時間、影響Knowledge IDs／可信導航，且失敗不會標為Removed。

新增 Q&A 尚無 canonical Knowledge ID／Mock Site Mapping；報告不自行編造目的地。審核時應針對醫起通、聯盟鏈、合作院所、資格條件與紙本／匯款規則確認要採用哪些原文，再決定是否更新既有 `service:claim_union_chain`／`service:claim_hospital_upload` 或新增條目。不能因擷取成功就全部批准。未另抓第三方FAQ；既有來源沒有的門診或地址規定不自行補寫。

### 可重現指令

先使用本地含 requests、BeautifulSoup、markdownify 的 Python 環境，以及 Node22。以下皆在 Repo 根目錄，輸出路徑必須不存在：

```sh
# 已有 capture 的純離線重建，不 refresh retrievedAt
python scripts/crawler/targeted_review.py \
  --from-snapshot data/crawl/capture-2026-10-21 \
  --out <fresh-candidate-directory> --report <fresh-report.md>

# 只有明確授權的下一次公開 HTML 擷取才省略 --from-snapshot
python -m unittest discover -s scripts/crawler -p 'test*.py'
npm run eval:knowledge
```

段落 ID = heading path + content hash + 同內容出現次序，非陣列位置；同內容重複時仍各有ID。語句改動配對採同節唯一相似候選，僅為人工審核輔助，不是自動保險語意判斷；順序變動也會獨立標示。

## A 的整合與日期契約

[97個既有 Source ID 與日期／導航對應](knowledge-source-dates-2026-10-21.json) 保留目前正式 Knowledge。`dateBasis=entry` 為明確條目日期；`legacy_dataset_fallback` 是既有資料集日期備援，不可宣稱本次逐條重新擷取。

- 頁尾：`meta.crawled` 仍為2026-10-06，表示現行已採用資料集的整理日期，沒有因候選擷取改為今天。
- 來源卡：canonical source 的 retrievedAt；地址 `service:change_address` 與既有7個 glossary 條目仍為2026-10-20。其餘未採用條目的日期保持原狀。
- 新 capture 的逐頁ISO時間只在候選報告，非官方發布日；沒有來源提供的 publishedAt，不能產生 publishedAt。
- A 的日期／來源UI已包含在 Release 1；現有 Journey、Document、Intent、Navigation API 沒有破壞性改動。
- 後續批准FAQ／表單逐條日期時，需要同步擴充公開projection及shared adapter以保留這些 optional 日期；本輪尚未採用，因此沒有假裝已完成此接線。

## 待人工審核／尚未部署

**Release 2 未執行，採用條目為空。** 請在最終 candidate checklist 逐筆選 approved／rejected／needs_followup，填 reviewer、reviewedAt、decisionReason。沒有決定的條目維持pending。批准後才更新Seed、公開projection、逐條日期與白名單映射，重新同步main、Regression、安全掃描，再部署Release2。

目前仍是HTTP／無案件授權的競賽展示，只能用合成資料，不能接受真實醫療或銀行文件。真實Gemini、真實OCR／文件辨識、核賠、真正送件與長期容量測試均不在本次驗收範圍。

## 管理與回復

只對新VPS執行：

```sh
ssh -i ~/.ssh/navi_vps -o IdentitiesOnly=yes root@207.148.113.119
python3 /opt/navi-hackathon/scripts/manage.py status
python3 /opt/navi-hackathon/scripts/manage.py restart
python3 /opt/navi-hackathon/scripts/manage.py stop
python3 /opt/navi-hackathon/scripts/manage.py rollback
journalctl -u navi-api.service -f
```

更新沿用 [專用VPS指南](vps-dedicated-deployment.md) 的固定SHA本機Build→封包checksum→install→activate流程，不重新初始化伺服器。NAVI deployment manifest已更新並先備份至專屬config目錄；沒有清理舊Release或其他服務。
