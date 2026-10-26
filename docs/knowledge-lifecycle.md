# NAVI Knowledge Lifecycle 操作指南

本機定向擷取、人工審核、不可變知識版本、雙站建置與回滾。沒有公開管理寫入入口、不執行 Gemini、不採用付費服務。`docs/presentation`、錄影、簡報與展示證據不屬於此功能的Git交付。

## 本輪盤點與完成範圍

| 能力 | 原狀態 | 本輪結果 |
|---|---|---|
| 固定8頁擷取／robots／限速 | 已有 | 沿用，補逐跳白名單、原始HTML保存、增量與重播 |
| SHA／段落差異與候選 | 部分完成 | 沿用抽取器，補重複內容、失敗保留及穩定候選匯入 |
| 23項候選清單 | 已有 | 匯入本機受控審核區，全部仍PENDING |
| 審核寫入權限與歷程 | 缺少 | 私有CLI憑證、狀態、操作者、理由、簽章歷程與寫入鎖 |
| 版本發布／原子啟用／回滾 | 缺少 | 不可變版本封包、實際111題評估、來源／導航／公開欄位驗證 |
| 產品搜尋／Evidence／Grounding | 已有 | 沿用同一成熟引擎，正式快照附版本，新Metadata API保持舊契約 |

2026-10-26執行既有8頁來源：第一次7頁成功、1頁失敗；只針對原白名單的失敗頁再次複驗成功。最終8個來源均取得，重播未新增重複候選。這輪內容無新增、修改或移除，既有23項仍待審，正式採用0項。不將重新擷取時間套用到尚未採用的Knowledge條目。

## 現況與資料邊界

- PR #7 已合併。`data/crawl/capture-2026-10-21` 是原始整理輸出（28項）；`candidate-2026-10-21` 與 `docs/knowledge-crawl-diff-2026-10-21.json` 是正規化後23項候選。23項仍待人工審核。
- `data/cardif_seed_data.json` 保留原始人工整理基線。正式產品讀 `data/cardif_public_data.json`，每次啟用是單檔原子替換，不同時讀取兩個可能不一致的知識檔。
- `knowledge/releases/<version>.json` 是不可變的公開版本封包，含 snapshot、SHA-256、Source Manifest、批准Change IDs、發布時間、Schema Version及前版參照。不包含憑證、審核者或內部筆記。
- `data/private/knowledge/` 是0700本機管理區，已被Git忽略。含600憑證、具HMAC與前項雜湊的審核歷程、候選、raw HTML與擷取報告。建置工具不打包此目錄。
- `meta.crawled` 是整份資料的實際整理／採用時間；`retrievedAt` 是來源擷取日期。現有前端契約仍是 `YYYY-MM-DD`，候選與原始快照另保留具時區的完整ISO時間。`releasedAt` 是軟體知識版本發布時間，三者不是官方內容發布日期。

## 初始化與狀態

```sh
npm run knowledge:init
npm run knowledge:status
```

init 僅替既有已驗證公開資料建立基線版本，不核准或採用任何候選。只輸出本機憑證路徑，不能把憑證內容加入Git、URL或前端。其他寫入操作必須帶 `--token-file`；目錄與憑證必須由目前OS使用者持有且權限0700/600。不具備OS權限者不能操作，這不是對外登入系統。

## 定向擷取與增量比對

沿用 `scripts/crawler/targeted_review.py`、既有抽取器及白名單。需要既有免費Python套件 requests、beautifulsoup4、markdownify，可用專案外venv：

```sh
NAVI_CRAWLER_PYTHON=/path/to/venv/bin/python npm run knowledge:refresh -- \
  --token-file data/private/knowledge/access-token
```

只讀8個固定公開HTML來源，核對robots；逐跳檢查白名單、至少1.5秒間隔、2MiB上限、最多一次暫時性重試。不下載PDF、不登入、不送表單。PDF僅保留公開連結資訊。禁止擴大白名單來繞過失敗。

每次輸出新capture、原始HTML、raw/normalized SHA、段落ID、HTTP/抽取狀態、JSON/Markdown差異與審核清單。原始HTML可按hash獨立重驗。舊快照欠缺raw HTML時不捏造原始bytes。只有內容比對，不將抓取失敗當作刪除；latest-pages保留每個來源最後一次成功內容。多次擷取相同內容會保留不同的擷取記錄，但不重複新增審核候選。

離線重播（不改擷取日期、不使用網路）：

```sh
npm run knowledge:refresh -- --token-file data/private/knowledge/access-token \
  --from-snapshot /path/to/capture
```

單獨匯入既有候選：

```sh
npm run knowledge:import -- --token-file data/private/knowledge/access-token \
  --report docs/knowledge-crawl-diff-2026-10-21.json \
  --snapshot data/crawl/candidate-2026-10-21
```

## 人工審核

```sh
npm run knowledge:review -- --out artifacts/knowledge-review.md
```

查看完整前後文、官方URL、擷取時間、前後SHA、段落ID、Knowledge IDs與導航。狀態為PENDING/APPROVED/REJECTED/NEEDS_FOLLOWUP；這份報告不能自行授予核准。

核准內容前，人工建立本機 mapping.json：

```json
{
  "sourceId": "faq:1",
  "field": "a",
  "value": "逐字存在於這筆候選官方快照的內容",
  "entryReviewed": true,
  "workflowCompatibility": "reviewed_no_rule_change"
}
```

```sh
npm run knowledge:review -- --token-file data/private/knowledge/access-token \
  --change 'change:<id>' --status APPROVED --reviewer Sh \
  --reason '已核對完整來源、上下文與流程相容性' --mapping /private/mapping.json
```

拒絕與追查使用REJECTED或NEEDS_FOLLOWUP，仍須審核者與原因。PENDING也可明確重置，但會新增歷程，不刪除舊決定。整頁／結構項目需額外 `--whole-page-confirmed`，它只代表已完成整頁審查，不自行加入保險內容。

只能對既有Source ID的公開內容欄位建立映射，不能改ID、URL、導航、Readiness權重或Workflow。注意事項的刪除可逐筆審查；應備文件／來源整筆刪除與新增Source ID需另行遷移並由A確認 `data-tour-id`。涉及理賠條件改動時請用NEEDS_FOLLOWUP，另做規則相容性審查，不以文字變動直接修改確定性引擎。

## 發布與回滾

```sh
npm run knowledge:publish -- --token-file data/private/knowledge/access-token \
  --change 'change:<id>,change:<another-id>'
npm run knowledge:diff -- --left kb-<old> --right kb-<new>
npm run knowledge:rollback -- --token-file data/private/knowledge/access-token \
  --reviewer Sh --reason '說明恢復上一個已驗證版本的理由'
```

未指定change時也只採用APPROVED、有有效映射的內容；沒有批准內容就回adopted=0。PENDING、REJECTED、歷程／候選被竄改、來源原文不符、Schema失敗、導航缺失或評估未過均拒絕。審核綁定當時基線，基線改變需重新審核，衝突欄位不自動覆寫。

發布前完整驗證公開欄位白名單、排除筆記指紋、來源日期、現有Source IDs／導航與原文，並執行實際Knowledge評估。建立不可變版本後才單檔原子啟用；異常保留原版本。回滾重驗來源／搜尋／導航，留下時間、操作者與理由，審核歷程不刪除。

本機啟用供建置使用。雙站是靜態產物，API在程序啟動載入同一公開快照；正式切換必須把快照與公開版本封包提交PR，通過既有Build／Regression後以現有Release工具部署。不能在VPS直接改JSON或假稱現有程序已熱更新。整個應用Release也可回滾，兩站與API因此保持一致。

## Backend / A 接入

- 既有 `/api/knowledge/search`、`/api/knowledge/evidence`、Journey Source與postMessage格式不破壞。Search回應及條目新增 `knowledgeVersion`，來源ID保持原樣。
- 新增 `GET /api/knowledge/version`：版本、發布時間、SHA、Source Manifest、前一版、批准Change IDs；不含private review資料。
- 新增 `GET /api/knowledge/versioned-evidence?query=...`：`{ knowledgeVersion, evidence }`，evidence仍為既有EvidenceResponseSchema，提供標題、URL、日期與核對過的摘錄。A可在來源卡顯示外層knowledgeVersion，不需修改舊Journey Source Schema。
- `shared/knowledge/index.js` 的 `createKnowledgeEngine(snapshot)` 沿用同一排名與驗證邏輯。候選只在隔離引擎評估；預設前後端引擎只載入正式公開快照。Grounded context也附版本，仍禁止描述成即時官網查核。
- 未新增公開審核／發布API或後台。這些寫入一律在本機CLI完成。

## 零成本展示與測試

```sh
npm run knowledge:demo
npm run test:knowledge-lifecycle
/path/to/crawler-venv/bin/python -m unittest discover -s scripts/crawler -p 'test_*.py'
npm test
npm run eval:knowledge
npm run eval:hospitalization
npm run eval:ai:local
npm run lint
npm run typecheck:mock
npm run build:all
```

Demo在隔離臨時目錄執行，合成資料標記synthetic_demo、來源為prototype/isMock；本機測試審核者明確標示LOCAL-SYNTHETIC-DEMO，不冒充真人批准官方內容。正式根目錄禁止啟用合成版本。輸出證據只放忽略的artifacts，不push簡報或影片。沒有Gemini、付費API或新增主要相依套件。
