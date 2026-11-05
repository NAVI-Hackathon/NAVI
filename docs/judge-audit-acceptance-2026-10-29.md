# 第二輪評審技術稽核驗收 — 2026-10-29

整理 UTC：2026-10-29T09:31:19.932136+00:00。程式來源 SHA：`2d26d5303525cb20c6c197ff0d26376d482d9a9d`。這是候選修復與工程證據，不是正式上線宣告、不是真實使用者成效或新Gemini品質結果。Gemini生成0、重試0、換模型0、付費API0、正式變更0。

## 同步、分工與發布決策

- 最新 origin/main：`6bc1a90d49a50344d4fde89b873bcbf622faeb38`；Production：`d123b2cf4be185c7d7d8966456fcb93d2de10739`，兩者不同；文件PR合併不等於應用部署。
- 分支 `fix/b-judge-audit-reliability`，以最新main建立，不從舊修復分支開發。原始本地 `docs/phase-2a-report.md` 修改保留；沒有reset/clean/force push。
- A 的開放PR #33：`feat/a3-frontend-integration` / f780fdf577836b246389515a9d4ca443c33e2bda，修改App、Landing、TaskBar、Dialogs與client。這只代表可見Git分支，不能確認Claude Code未儲存工作。B沒有修改apps/web或mock-site；Schema optional擴充已由Sh同意，A負責Renderer。
- PR #35的graceful shutdown、fresh socket、真正Mongo readiness、互斥/冷卻/一次恢復已另有隔離實測，本輪不重寫、不部署、不放寬StartLimit。它目前未合併；本PR不是替代其正式驗收。
- **阻擋發布：E13仍3個Renderer失敗**。Backend與Schema通過不代表完整網站已修好。本輪只建立Draft PR，不合併、不正式部署、不做VPS回滾演練。

## 風險矩陣與修復

| 問題 | 根因／本輪處理 | 驗證與狀態 |
|---|---|---|
| NAVI-001 | retrieval有結果且understanding=null是合法回應；App建立answers訊息未提供followUp，Landing讀showAnswers白屏 | Backend契約/fixtures完成；E13六題3通過3失敗，待A Renderer |
| NAVI-002 | 變更/保單/給付等共同詞與本文命中，蓋過付款與紅利主題 | 先過主題適用性再排名；同義、負例、英文、正確Source和Destination驗證通過 |
| NAVI-003 | 模糊詞誤命中「戶政連線」本文 | 無明確服務先澄清，不自選事故/死亡/院所/日期；Mock高信心亂猜也被normalizer擋下 |
| NAVI-006 | 需確認前端使用同一份當前Journey | 沿用extractedData/documents/claimContext/stage/readiness/consistencyIssues；新增建立/上傳/冪等/替換/移除/reload整合檢查 |
| NAVI-007 | 僅避免承諾但未明確拒絕保證 | 保證核賠要求明確拒絕，提供流程/文件/客服方向；不把正常「一定要正本嗎」誤判為保證要求 |
| NAVI-008 | 日期語境不明仍選管道/證件FAQ | 先問事故、住院出院或文件日期；未提供日期不補猜、不跳身分證發證日期 |
| NAVI-009 | 地址/受益人/付款前置條件不明 | optional非阻擋來源閱讀的澄清；不從入口或欄位完整推定資格 |
| NAVI-013/014 | 真實AI證據不足及測試類型混用風險 | 只保留既有I21 Google503，未執行v2案例保留notRun，文件F1=null；新離線成績不當Google準確率 |
| NAVI-015 | 發布/回滾與資產追溯、資料恢復 | 正式唯讀hash/ready；PR35已隔離驗證但未部署；本輪補erasure-aware restore、舊登入/配額不復活 |
| NAVI-016 | atlasAdmin過大權限 | 不改Atlas；真本地--auth readWrite允許NAVI、拒絕跨DB及角色管理，正式切換仍待授權 |
| NAVI-017 | 商業/UX數據尚需真人研究 | 提供請求/容量/工時公式，不造ROI或真人數字；A/B依既有protocol |
| NAVI-018 | 舊備份可把已刪除資料帶回 | 交易tombstone＋新鮮簽章erasure plan＋coverage gate＋空白還原庫；隔離通過，Production未部署 |
| NAVI-004/005/010/011/012/019 | 本附件未提供對應缺陷細節，沒有擅自擴大功能 | 不宣稱本輪已驗收或修復；需依原始評審清單由負責人追蹤 |

## B1–B4的實際變更

純ESM的query profile/同義詞/主題配對沿用既有引擎，沒有平行Knowledge Engine、不改Seed或Source IDs。

- 「我要變更保費付款方式。」現在Top1 `service:change_payment_method`，anchor `service-change-payment-method`；紅利領取仍為 `service:change_dividend_option`，anchor `service-change-dividend-option`。紅利轉帳不因「轉帳」就變保費；抵繳保費及否定子句也有反例。
- 「我不知道要辦什麼。」status=not_found，無結果/無Plan，clarification=service_unspecified。「我要申請理賠，可是忘記日期。」同樣先問日期與理賠類型，沒有新Journey/日期。
- 「幫我保證一定可以理賠。」status=out_of_scope，明確無法保證核賠；正常文件流程仍可查。「不需要判斷會不會賠」和真的要求保證分開，不能刪去後面獨立的肯定要求。
- Conversation grounding驗證失敗後清除部分解析的understanding，不再保存模型任務。retrieval-only保留errorCode及optional failure（靜態繁中message/retryable），沒有Demo假資料。
- 服務入口與已符合資格分離，100%仍只代表資料準備；文件verification.authenticity/eligibility仍not_assessed，不宣稱真偽或核賠通過。

完整[API/Renderer契約](judge-audit-contract.md)、JSON Schema `docs/a3-product-schemas.json`、共用合成fixtures `tests/fixtures/judge-conversation.js` 已提供A。新欄位optional，舊status/endpoints/Source/Navigation不改。

## 本輪測試與不得混用的分母

| 套件 | 實際結果 | 方法/限制 |
|---|---|---|
| npm test | Frontend86/86、Backend423/423 | 本機規則、Mock Transport、真正隔離Mongo；不是Google |
| 新Judge Knowledge/Safety | 42/42（包含在Backend內） | 原句、同義、英文、混淆、正反否定與來源/導航 |
| 新Conversation/Journey | 11/11（包含在Backend內） | 真Express/Mongo、Mock Provider；35→70→90→100、刪除回70、替換/重複/重載 |
| 新Erasure Recovery | 4/4（另有上列Journey舊快照測試） | 真replica set/交易/加密備份/空白還原DB，並非正式Atlas還原 |
| 新Database Role | 1/1 | 真本地--auth，三種非授權操作均code13；不是Atlas已最小權限 |
| Knowledge Evaluation | 134/134；Top1 85/85、Top3 85/85 | Snapshot規則，不是AI語意準確率；檢索p50 0.26ms、p95 0.601ms |
| Hospitalization / Legacy | 76/76、120/120 | 不同本地題組，不相加成AI品質 |
| v2 Frozen Mock | 28/28（16Intent＋12Document） | 腳本提供模型輸出再走真validator，不是真Google；v1既有35/36/H17差異仍保留 |
| Navigation audit | 107 plans／157 steps／7 pages，issues=[] | 只證明目前build的mock-site；前版manifest缺少，Deprecated未判定，非正式法巴整合 |
| 既有Product Browser | 5/5（390px、1280px、歷程、草稿/恢復及登入競爭） | 真Browser+隔離Express/Mongo、Mock Transport，不是真Google或正式登入驗收 |
| E13 Browser | **3 passed／3 failed** | 固定API fixtures，真正A Renderer；下列缺陷仍在 |
| Lint / typecheck:mock / build:all | 通過，Public Asset findings=[] | 實際scripts；沒有宣稱不存在的root typecheck指令 |
| 本輪Live Gemini | **0次** | 沒有新生成授權、沒有重試/換模型/付費 |

E13失敗：retrievalOnly、timeout、quota；pageerror=`Cannot read properties of undefined (reading 'showAnswers')`。通過：noResults、clarification、insuranceBoundary。原始error-context、JSON/pageerror和截圖已另存忽略的 `artifacts/judge-e13-results/`，不因其他Browser測試覆蓋而消失。這不是Google503的原始證據，而是獨立Renderer缺陷。

固定v2 SHA：`b4e8215133a3c7b9d3157af152c41eabee3c206d5cef249d95b56740b6d09920`。本輪沒有修改GT、媒體、Manifest。曾因新安全guard未正確處理否定語境，使I32變成preview，該次27/28與原始suite失敗完整保留；修正通用否定範圍後重跑。**v2本輪已用於回歸定位，不再當成未接觸的外部盲測**；它始終是developer-authored，independentHeldOut=false。

另有一次完整本地執行發生52個Mongo連線失敗，保留原log及隔離mongod log；未獨立證實根因。加本機診斷的獨立重跑418/418及其後一般重跑418/418通過，最新固定程式為423/423；沒有提高Production timeout或刪除失敗測試來通過。當時和最新的分母不同，不把它們加總成可靠性百分比。

## Production唯讀追溯

採樣UTC 2026-10-29T09:05:47.928Z。新VPS只有唯讀觀測；未重啟、未換流量、未CRUD正式使用者、未更改憑證或quota。

| 項目 | 實際值 | 證明範圍 |
|---|---|---|
| Production | `d123b2cf4be185c7d7d8966456fcb93d2de10739` | Release/ready marker一致；不是本PR已部署 |
| Release | `d123b2cf4be1-1793189924` | 現有current指標 |
| Release Manifest SHA256 | `c6f189d5ecb7f5bd49c3f2a53c5bf07de743e08e1c2a54adb0f405318aa131ab` | 原始manifest檔案hash |
| Artifact SHA256 | `3674d64e426ab37cb22efc9bcdf6be81f30afc26eab012e7b05cd01bc3b61f45` | 已安裝ready marker記錄的artifact hash；本輪未重新安裝archive |
| Backend Server Source SHA256 | `3e83ccf70268f195a0b86ac17af877fba92e8ca09d0c48b6b05449ca38b4acde` | 實際release server.js，不代表所有設定相同 |
| Backend Config Source SHA256 | `f267d43cf5691d7c4613e0dc82cb3f9b70ea3d55312ee52a46a50adab918a0f8` | 設定程式碼hash；實際白名單配置另由唯讀snapshot記錄，不匯出env |
| Public HTML / assets | 主站及App HTML hash吻合；21 JS/CSS hash全吻合、內部欄位未發現 | 對應manifest；本機新Build另做JSON/maps/static安全掃描，不宣稱逐一下載Production所有JSON/maps |
| Mongo /ready | 200、mongodb_encrypted、TLS/ping=true | 當下DB可連線；不單獨證明owner/備份/加密全部通過 |
| Knowledge | kb-1404d058190e380c66eedee1 | 與正式ready一致；23approved→10FAQ已從原真簽章庫重新只讀驗證，沒有新核准 |
| 目前Provider | live / gemini-3.1-flash-lite / paidAllowed=false | 配置盤點，不是真實生成成功 |
| 日/Session/並行/Timeout/Attempts | 0/20（Pacific 2026-10-29）；1/6；1；10000ms；1 | 採樣不是預留；現有Session只剩5次。沒有新Live授權，不承襲舊剩餘預算 |
| API/Nginx | active，Result=success，NRestarts=0 | API ExecMainStart仍2026-10-28 15:32:32 UTC；本輪沒有重啟 |
| 資源 | MemAvailable540MiB；Swap43MiB；load0.09/0.06/0.01；OOM lines0 | 單次快照，非壓力/壽命保證；RSS另見process資源原始log |
| 回滾 | previous=`69ec66967156-1793189533` | 指標存在不等於schema/env/erasure相容性及新systemd行為已驗收 |
| 精確Deployment timestamp | **null / 本輪未取得可靠切換時間戳** | process啟動時間、release資料夾生成時間不可冒充流量切換時間 |

正式公開路由用真正Chromium只讀驗證5條（main/app/demo/embed/embed-demo）；攔截Session/資料API與非GET，只放行health/ready/ai-status讀取，不建立帳號/Journey或觸發生成。不以此宣稱本輪真實登入/文件E2E全部通過。

預設 knowledge:verify-release 曾因本工作樹缺少私有Store而失敗，log保留；找到原始受控Store後，使用原listReviews及verifyFaqRelease純函式只讀重驗，結果23核准/10FAQ/同版本，沒有初始化新Store或捏造審核。retrievedAt維持原擷取日，publishedAt=null，不把抓取/發布版本時間當官方發布日期。

## 既有Live證據與企業限制

I21真Google503 UNAVAILABLE，model gemini-3.1-flash-lite、Production d123b2cf、2026-10-28T15:39:09.994Z；Provider3241.93ms、Service4167.24ms、1/6 requests、retry/switch/Demo/paid均0、Token Usage=null。無語意輸出，不能稱分類錯誤或新模型準確率；文件F1=null，其餘27題notRun。歷史e2a6100的3次成功不納入新版分母。[Google錯誤說明](https://ai.google.dev/gemini-api/docs/troubleshooting)不能證明本次503就是Free Tier不足或Prompt錯。這與E13 Renderer白屏必須分開交代。

真Atlas16/16與Production HTTPS帳號8/8仍屬歷史有來源的驗收；原始雜湊/版本見 `docs/final-technical-evidence.md`，本輪沒有對正式使用者重做CRUD。新版本Google品質、正式systemd回滾、iPhone Safari實機、SMTP、企業SSO/CRM/理賠送件均沒有新成功證據。

Atlas仍atlasAdmin，最小權限與輪替只準備未執行。公開註冊因SMTP未配置仍關閉；實際政策禁止真實醫療/銀行內容，不能把勾選合成當成可靠的PII偵測。Handoff是草稿/下載、delivery=not_sent，不是客服工單或送件。保存30天滑動、備份約7天輪替；本候選還原防護未正式安裝。來源/最新ledger均遺失時不宣稱可安全災難復原。

[Erasure恢復方法與限制](judge-erasure-recovery.md)及[最小權限/企業責任/成本算式](judge-audit-operations.md)已提供。沒有新增受測者、第三組或虛構ROI；A/B仍依A的protocol。A待接Renderer的followUp安全處理、optional clarification/failure及實機驗收；Backend不假造UI需要的understanding。

## 可重現指令與原始證據

開發機Node≥22.12，MONGOD_BINARY為官方本機MongoDB，測試URI只能loopback。`npm test`、`npm run eval:knowledge`、`npm run eval:hospitalization`、`npm run eval:ai:local`、`npm run eval:holdout:v2:mock`、`npm run test:navigation`、`npm run lint`、`npm run typecheck:mock`、`npm run build:all`；E13：`npx playwright test -c tests/product/playwright.config.js tests/product/judge-contract.spec.js`（目前預期會揭露3個實際失敗，不能當綠燈部署）。

Raw artifacts全部忽略，不提交Cookie、密鑰、審核token、錄影、簡報或完整私有Log。以下hash只用於脫敏證據追溯；mtime是檔案保存時間，非模型延遲。

| 原始報告 | UTC（保存時間） | SHA256 |
|---|---|---|
| `artifacts/judge-audit-acceptance-tests.log` | 2026-10-29T09:25:53.370391+00:00 | `d5baa6424f8c7f75654d5596a4cbc035a98bc882e1c481d8b0a49b7020b1011b` |
| `artifacts/judge-audit-acceptance-knowledge.log` | 2026-10-29T09:24:37.125181+00:00 | `bc66a8aad2423357d9c4fb4e902b6e3778d937a387d6429f2d26b64968a8f30a` |
| `artifacts/judge-audit-acceptance-v2.log` | 2026-10-29T09:24:37.463779+00:00 | `2d5e17599f4ec55379c9058d47932325df48a6998186ae4d6d212b0cc33c20ab` |
| `artifacts/judge-audit-committed-hospital.log` | 2026-10-29T09:10:20.565553+00:00 | `1e495389f041e973885cab914be55fd744d583c4d240d207286a502b7626652f` |
| `artifacts/judge-audit-committed-legacy.log` | 2026-10-29T09:10:21.104510+00:00 | `2995a53878df697bcc50fcc4738c9bab337794df08cf6b58dbc9b3ee7d1425f2` |
| `artifacts/judge-audit-committed-navigation.log` | 2026-10-29T09:10:21.769962+00:00 | `d22bae32ab94d3a561bd16d79b37afedc786acefbf7c92b5d044e6984ef88ad3` |
| `artifacts/judge-audit-e13-browser.log` | 2026-10-29T09:00:04.979038+00:00 | `92b3b3ad7b6da3b7c873bf0883a953a8304fcf7bba98224613aafde1f1dc42cc` |
| `artifacts/judge-audit-role-boundary.log` | 2026-10-29T09:11:20.942676+00:00 | `b3edb23908a142ea23b9430e34dbf9d912b7c285f4560ca59a8ec6e65342b293` |
| `artifacts/judge-audit-acceptance-lint.log` | 2026-10-29T09:24:37.681807+00:00 | `175f844d2f68f6f4c30881cdfaf6f0905ee44aa3c0d40278e20355c9a63a82a5` |
| `artifacts/judge-audit-acceptance-typecheck.log` | 2026-10-29T09:24:43.555238+00:00 | `bcd01820acb4c2c7aaa2c5ad7b59ea804954cf071853a72e39f22738c29bc9e2` |
| `artifacts/judge-audit-acceptance-build.log` | 2026-10-29T09:24:52.870605+00:00 | `5cf0396650012e719484b3e50159ce6795ae0b0ac788914e55f37f7baa640910` |
| `artifacts/judge-audit-production-state-final.json` | 2026-10-29T09:05:48.115664+00:00 | `991df59492cb7d14ca6ed6a41bf65ae162a88efb2fa742787d918c18a69d8955` |
| `artifacts/judge-audit-production-manifest.json` | 2026-10-29T09:08:17.106621+00:00 | `c13010351b77e63f2d306dfc180ba370c93bc7262ae112dc6b2ff374ab1f9320` |
| `artifacts/judge-audit-production-assets.json` | 2026-10-29T09:17:45.356408+00:00 | `09c84ab7e9fd215b7096c3692ed9abfc4afc5d2cb60b9fda0137b9391072349b` |
| `artifacts/judge-audit-production-html.json` | 2026-10-29T09:25:58.129843+00:00 | `fc210e1a8f4bbd7f828fb19f6ab6d746f695cd8988ed71069e0d0932dcf2bda1` |
| `artifacts/judge-audit-public-browser.json` | 2026-10-29T09:10:23.579428+00:00 | `d9d34ed932644c29714f57d10dc8954994d397e2312466b5f34584c4c1f6134f` |
| `artifacts/judge-audit-health.headers` | 2026-10-29T09:08:17.578128+00:00 | `5b86ab56103ad1921bd8b0de7f62cd48747e1096c013f5f8a64b7c8bb320db96` |
| `artifacts/judge-audit-ready.json` | 2026-10-29T09:08:18.058970+00:00 | `55e02d995180155ca5f78e77a5474c9d39930c7935f2f1c57cdc1f23b3980fea` |
| `artifacts/judge-audit-process-resources.log` | 2026-10-29T09:23:01.975616+00:00 | `d103f9d73de94e263527cc7f2dd766a83241d93bf26352c21609706b681658db` |
| `artifacts/judge-audit-knowledge-version.log` | 2026-10-29T09:25:58.412555+00:00 | `bff6ebdbba412463b73e56495187b6ae95b2cba5399f9e62d1f63539e1c6b56d` |
| `artifacts/judge-audit-knowledge-version-reverified.json` | 2026-10-29T09:27:31.365195+00:00 | `d6bd616377ec05277625f940bfd558a0512ea18a09823f5d3073939372259e80` |
| `artifacts/judge-audit-committed-tests.log` | 2026-10-29T09:10:13.224533+00:00 | `70666e20de44e36ea35c7e1ba1cea2f8bb63d2e5460f5bb9fca6cadc22aabf98` |
| `artifacts/judge-audit-diagnostic-tests.log` | 2026-10-29T09:14:10.591749+00:00 | `bf0bd94d3d386fb47cdf38c8b172c38d4d0ce1b927c1d2cfd85c2953da1cb7e0` |
| `artifacts/judge-audit-release-tests.log` | 2026-10-29T09:22:08.251377+00:00 | `352a16b41ca5e4fceb7dff952970d4e28a63fd6d9b4249375bd3952059ebca7a` |
| `artifacts/judge-audit-release-v2.log` | 2026-10-29T09:20:57.023465+00:00 | `7411bb055e0b15db05008bd916ded661fb5e543ab72dd0e90e7e7fb4edf7da4f` |
| `artifacts/final-live-evaluation/I21-raw.json` | 2026-10-28T15:39:45.841213+00:00 | `db48703e3e8c0435c7f28a92ee2d7762207f6f7ffbe3ad9154e629c15ab7bd42` |
| `artifacts/final-live-evaluation/report.json` | 2026-10-28T15:39:46.077919+00:00 | `7a2b291303abe37256a3506c14b483905721236ae1fe6e6c3c2be45db03679ce` |
| `artifacts/judge-audit-product-browser.log` | 2026-10-29T09:28:40.453695+00:00 | `4e064d300a79ab774d1454dda1845cc13568c09c8b7a78ca6051a1e53869b871` |

## 最終狀態

- **已實作**：主題排名、澄清、核賠保證拒答、失敗契約、grounding後不保存壞任務、刪除/還原防護。
- **已通過離線**：固定版單元/整合/Mock/隔離Mongo授權與還原、Build/公開掃描；不是新Google品質或正式最小權限。
- **真實Browser/正式唯讀**：公開五路由、HTML/資產/Release/ready/資源；E13有3個實際Renderer失敗，不是全通過。
- **真實Gemini**：本輪0；只保留歷史成功與I21失敗，分母/版本分開。
- **尚未驗收／發布阻擋**：A Renderer、正式回滾新工具、異地erasure journal/停寫證據、Atlas最小權限、真實敏感資料與企業串接。
- **需要另行授權**：任何新生成、權限/密鑰/IP變更、正式高風險維護/切換/回滾。本輪沒有進行。
