# 決賽工程驗收 — 2026-10-29（台灣）

整理UTC：2026-10-28T19:08:10.548644+00:00。本輪只修改Backend/部署工具/測試/技術文件，沒有新的Gemini生成或付費API，沒有VPS切換、重新啟停、CRUD演練或Atlas權限變更。技術文件與原始失敗分開保存；不提交簡報、憑證或原始API紀錄。

## 版本與PR #34審查

- PR #34已合併，Merge/main為 `6bc1a90d49a50344d4fde89b873bcbf622faeb38`，只有文件；**沒有因此部署**。Production仍 `d123b2cf4be185c7d7d8966456fcb93d2de10739`。
- 審查核對I21 Google503原文、Token=null、0/1為API錯誤不是語意誤判、文件F1=null、notRun27、Mock28/28不混算；本機原始雜湊比對與Key/Cookie/URI樣式掃描通過。另澄清「全28未執行」是歷史Preflight快照，後續為1錯誤＋27未執行。
- Backend修復commit `ceaa7f0`、`9372be6`，部署修復`5ccd1c9`、`ca7072b`、`e6a7a50`，最後測試隔離修正`dd6cb69585a5f8a6f56e94fd9d9dcd763460b1ae`；均**尚未正式部署**。既有Production/Atlas數據不能當成這些新修復的正式驗收。

## 503分析：已確認與未知

原始Google回應code503/statusUNAVAILABLE/message：`This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.`，UTC2026-10-28T15:39:09.994Z，model3.1 Flash Lite、d123b2cf、固定v2 I21。HTTP3241.93ms，Service4167.24ms；1/6生成請求、retry/model-switch/fallback/paid皆0。

這是[Google暫時不可用分類](https://ai.google.dev/gemini-api/docs/api-errors)與收到的上游錯誤，不能推出Free Tier額度不足、Prompt錯、語意能力差或特定機房根因。舊執行使用部署Provider/Services的獨立受控程序，不是Browser E2E；採用既有Mongo日用量/Session計數。

- Production product router已映射為AI_PROVIDER_ERROR/HTTP503/retryable=true，不是INTERNAL_ERROR。分析失敗沒有建立Journey、沒有計分或Demo回退。
- 發現Legacy transport仍將上游503統一成502：本輪保留既有error code，僅讓503保留503；其他錯誤分類維持相容。這項修復未部署。
- 一次失敗後circuit標記15秒、persist model_health；窗口內不再POST，恢復窗口後才可在新的操作嘗試。Mock使用可控時鐘驗證失敗、阻擋、恢復與audit；不是新Google請求。
- Queue為有界FIFO/加權slots，正式仍併發1、10秒、attempt1；沒有用恢復測試放寬。即時queue沒有本輪公開遙測證據，不能僅憑DB沒有active health列宣稱Google健康。
- `/api/ai/status.available=true`是已配置Live，不是探測Google可用；`/api/health`是程序存活，`/api/ready`是Mongo可用，均不代表真實生成成功。
- 本機真正瀏覽器注入503，確認繁中暫時不可用、人工重新分析及明確Demo連結；1.5秒不自動重送。手動後的成功也是Mock，不是Live。`intelligence.js`保留顯式可開的歷史fallback helper，但實際一般模式以apiJourney.js為入口，不是以該helper冒充Live；本輪不啟用VITE備援。

## 回滾根因與修復

手動啟動也計入[systemd StartLimit](https://www.freedesktop.org/software/systemd/man/257/systemd.unit.html)，不是只計自動重啟。前輪測試重用舊socket且反覆切換，耗盡300秒/3次啟動窗口；只恢復來源/環境後立即重啟並不能清掉該保護。失敗紀錄保留，不能改寫為原演練已通過。

| 檔案 | 實際修復 |
|---|---|
| apps/api/src/utils/shutdown.js、server.js | 單次drain、拒絕新API、關閉idle連線、等候在途HTTP及Mongo/maintenance；5秒強制HTTP收尾、9秒未完成再嘗試關閉store，最多250ms後失敗退出；deadline保持ref，避免無handle時誤以exit0結束。啟動/監聽失敗時關閉store，錯誤只記metadata |
| apps/api/src/app.js | drain期間health/ready回503 SERVICE_DRAINING；一般成功回應不變 |
| dedicated/manage.py | 每個probe新連線且close；區分liveness與真Mongo readiness，候選PID/cwd必須符合Release；即使product.enabled錯報false也不能略過Mongo |
| 同上 | 非阻塞部署鎖與持久化300秒冷卻；也檢查systemd最近啟動時間，拒絕短期連續操作；同版健康檢查為no-op；候選失敗僅恢復一次；成功切換可保留一次同PID、指定前版的立即回滾，使用後禁止來回切換；不迴圈或reset-failed |
| 同上、navi-api.service | 拆分api-current與公開current，先啟動/驗證API再切靜態current；失敗還原環境及runtime pointer、驗證舊服務；失敗日誌用唯一檔名保存 |

新增SERVICE_DRAINING僅是可重試503錯誤，成功Contract不改。A可沿用一般服務暫時不可用文案；本輪不改A的UI/動畫。

### 隔離實測（不是VPS演練）

本機使用真正Node/Express、HTTP、MongoDB replica set及加密marker；systemctl/nginx為明確模擬控制器。進程真正停止/重開，HTTP probe不重用舊socket；候選未Ready時公開current仍是舊版。兩個程序讀到同一保留marker。子程序套用既有networkGuard，外部HTTP/HTTPS傳輸封鎖；沒有Gemini呼叫。4/4整合測試及18/18管理器測試通過。

| 案例 | 實測完整操作至舊版/目標Ready耗時 | 測試時間UTC | Source SHA |
|---|---:|---|---|
| failed-ready-recovered | 2233.43ms | 2026-10-28T19:03:02.527448+00:00 | `dd6cb69585a5f8a6f56e94fd9d9dcd763460b1ae` |
| failed-start-recovered | 2108.39ms | 2026-10-28T19:03:05.862875+00:00 | `dd6cb69585a5f8a6f56e94fd9d9dcd763460b1ae` |
| success-rollback | 2139.44ms | 2026-10-28T19:03:11.521292+00:00 | `dd6cb69585a5f8a6f56e94fd9d9dcd763460b1ae` |

第四個案例為連續部署在停止前直接拒絕。成功切換後使用一次保留的立即回滾，再次反向切換在停止前拒絕，沒有推進時鐘或解除systemd保護。success-rollback的stopwatch量成功啟用加上立即回滾的完整操作；其他兩例量失敗操作至舊版Ready。這些不能當成VPS RTO或零停機承諾。控制器故意啟動失敗及Mongo Ready失敗都驗證恢復；恢復自身失敗則保留錯誤、停止反覆重啟。

早期本機測試曾因Linux /proc與macOS真實路徑差異、診斷輪詢撞上測試rate limit而失敗；改成實際/probe讀取程序cwd及提高僅測試fixture的HTTP limiter後重跑通過。另一次受外部網路封鎖的測試在本機Mongo啟動階段發生STORAGE_UNAVAILABLE，3/4通過；完整失敗log保留。原因未獨立證實，未提高正式逾時；獨立重跑最終4/4通過。原始失敗logs保留，沒有刪除既有測試提高通過率。正式API limiter不變。

### 正式套用前的必要步驟（本輪未執行）

1. 先審查修復PR及新Artifact，安排維護窗口與明確的正式切換/回滾授權，保留d123b2cf和配對env/資料備份。
2. 新manager要求unit的WorkingDirectory/ExecStart指向api-current；須在核准窗口將它先指到目前已驗證Release，再只調整unit路徑並daemon-reload，保留現有Atlas DNS/TLS egress服務與drop-in；不能以僅允許loopback的基礎模板覆蓋已驗證網路設定。**不能只替換manager而不遷移unit**；舊layout會在變更前被拒絕。
3. 等候目前300秒啟動窗口，確保備援也是Mongo相容Release。新manager不會略過保護、不會自動reset-failed；18個unit tests不是實際Ubuntu systemd已驗收；保留立即回滾僅可使用一次，且必須符合原PID/前版及零自動重啟條件。
4. 安裝SHA驗證的產物，activate後核對process cwd、Mongo /ready、來源SHA、API與對外路由。失敗時最多一次受控恢復；恢復不成功須停下回報，不能無限restart。
5. 目前仍是單API實例，會有短暫API重啟窗口；api-current分離避免未Ready就更新靜態站，但**不等於零停機藍綠部署**。新行為仍待核准的VPS驗收。

## 本輪測試與證據分層

| 項目 | 真正結果／方法 | 適用版本 |
|---|---|---|
| 完整npm test | Frontend86/86；Backend372/372，全部Mock/本機DB，不生成 | 本輪API程式；執行repo8aa4cc9，後續只有部署工具/測試隔離變更 |
| lifecycle測試 | 正常在途HTTP+重複訊號、超時失敗退出、DB啟動失敗不listen、無handle掛起close仍非零退出：4/4 | 8aa4cc9 |
| Deployment unit | 18/18；包含互斥、冷卻、Mongo不可略過、重複同版no-op、恢復失敗不再啟動 | dd6cb69（runtime e6a7a50） |
| 真實本機process/Mongo整合 | 4/4；上表耗時及marker一致性 | dd6cb69（runtime e6a7a50） |
| 503 Browser注入 | 1/1；Google替身503、不自動重送、明確Demo連結 | ceaa7f0，非Google |
| 凍結v2 | Dry Run＋Mock28/28；不動GT/媒體/manifest | 本輪，非AI準確率 |
| 本地Evaluation | Legacy120/120、Hospital76/76、Knowledge134/134；不同資料集不相加 | 本輪，非Google |
| Lint/Typecheck/雙站Build | 通過；Public Security Scan零findings | 前端未修改；無新的正式Artifact部署 |
| 本輪真正Gemini | **0次**；只有保留上一輪I21失敗 | 不宣稱新Live成功 |

### 重現指令（僅開發機／隔離環境）

Node至少22.12；MONGOD_BINARY指定本機官方MongoDB binary，不能使用Atlas URI。Python測試只針對臨時目錄，不能在Production執行。

```bash
npm test
python3 -m unittest discover -s scripts/deploy/dedicated -p test_manage.py
node scripts/test-mongodb.js -- python3 -m unittest discover -s scripts/deploy/dedicated -p test_recovery_integration.py
node --import ./apps/api/test/networkGuard.js --test apps/api/test/shutdown.test.js apps/api/test/provider503.test.js
npm run eval:holdout:v2:dry
npm run eval:holdout:v2:mock
npm run eval:ai:local
npm run eval:hospitalization
npm run eval:knowledge
npm run lint
npm run typecheck:mock
npm run build:all
```

## Production唯讀核對

採樣UTC 2026-10-28T19:04:09.726Z，Production `d123b2cf4be185c7d7d8966456fcb93d2de10739`；MongoClient直接TLS connect/ping與find/connectionStatus，**沒有呼叫MongoStore.connect的migration、沒有CRUD或新帳號**。角色仍atlasAdmin，未改憑證/角色/IP。

API/Nginx active、Result=success、NRestarts=0；API ExecMainStart仍2026-10-28 15:32:32 UTC，確認本輪沒有重啟。API RSS未另查（cgroup MemoryCurrent約48.5MiB）、Nginx cgroup約7.5MiB，MemAvailable554MiB、Swap31MiB、本次kernel查得OOM記錄0；這是單次快照，不是負載測試。HTTPS health與ready200、X-NAVI-AI-Mode=live、Cache-Control no-store；`/ready`為mongodb_encrypted，Knowledge kb-1404d058190e380c66eedee1。

本機真實Chromium唯讀檢查主站、App、Demo、Embed、EmbedDemo共5路由。攔截session/資料API與非GET，只允許health/ready/ai-status的GET；因此沒有建立Session/Journey或生成。這只證明公開頁面/模式顯示，不是新的文件/交接/Live E2E。

資料保存30天自異動延長、Session30天，SMTP未配置、公開註冊關閉；實際線上刪除不立即清除既有備份，備份約七天例行輪替。政策只接受合成資料，realPersonalDocuments=false；不能聲稱系統可自動證明所有使用者上傳都不含真實敏感資料，更不是正式核賠/送件入口。

## Live Preflight與Atlas方案

見 [新Preflight](live-preflight-2026-10-29.md)：已確認同專案Free Tier的近一日峰值畫面，但精確Google Request/Token剩餘無法可靠取得。NAVI日用1/20、既有Session1/6；只有5次Session餘額。本輪不清零、不新建Session、不換Key/模型、不沿用舊批准。新六題或五題都須另行授權，首次錯誤即停。

atlasAdmin為未解決風險，依使用者選擇本輪只記錄。後續最小權限方案：由帳戶管理者建立僅NAVI資料庫readWrite、限制既有Cluster的新帳號，root-only env候選切換；驗證createIndex/交易/常規API/備份，再批准撤銷舊應用管理員。還原到獨立restore DB須另一個只授權該DB的復原憑證，不能為了restore擴大應用readWrite權限。IP白名單不放寬。此方案尚未執行。

## A可引用與不可引用

- 原始Atlas16/16：`artifacts/atlas-acceptance-report.json`，真實DB/API、隔離Demo Provider，來源f4bfc12，不能當Google文件品質。Production HTTPS8/8：`artifacts/atlas-production-account-report.json`，來源d123b2cf。完整時間/雜湊保留於[技術Evidence](final-technical-evidence.md)。本輪未對正式使用者重做CRUD。
- 可引用：server-owned規則、真實加密Atlas持久化與曾通過的恢復/隔離/刪除/備份驗收；本輪18+4離線部署測試及503安全行為。各版本、方法、分母分開。
- 必須揭露：前輪回滾確實503，恢復後維持d123；新修復尚未部署。歷史Live3次成功僅e2a6100，最新d123的v2只保留1個Google503錯誤。沒有新的模型準確率、文件F1或使用者效益百分比。
- A負責真人A/B與iPhone Safari；本輪未改研究紀錄、不生成受測人數或改善幅度。公開註冊/真實敏感文件/正式送件限制不因簡報改版解除。

## 原始脫敏紀錄索引

下列程式測試SHA均指當時已提交程式；最後整合報告workingTreeDirty=true僅因兩份本報告尚未追蹤，tracked程式未修改。以下raw報告只在忽略的artifacts。JSON有envelope時採其UTC/Git；log以檔案保存UTC標示，不能當成模型延遲。SHA不含Cookie、Key、URI或密碼。

| 原始報告 | UTC（envelope或保存mtime） | SHA-256 |
|---|---|---|
| `artifacts/final-live-evaluation/I21-raw.json` | 2026-10-28T15:39:45.841213+00:00（mtime） | `db48703e3e8c0435c7f28a92ee2d7762207f6f7ffbe3ad9154e629c15ab7bd42` |
| `artifacts/final-live-evaluation/report.json` | 2026-10-28T15:39:09.995Z | `7a2b291303abe37256a3506c14b483905721236ae1fe6e6c3c2be45db03679ce` |
| `artifacts/atlas-acceptance-report.json` | 2026-10-28T12:08:33.275Z | `25a16adfa7f294e2e2a97abe134973526f52e507b933954b4beae9a2df35f5ad` |
| `artifacts/atlas-production-account-report.json` | 2026-10-28T12:20:20.526Z | `7669cb31f70fb3c22a6878bdb5fc5771917f6016aa1e826cab161aee25c2812f` |
| `artifacts/reliability-pr34-review-tests.log` | 2026-10-28T16:10:52.075606+00:00（mtime） | `7376469e166594eaea2db4f3673fe989d0e990a944c6a9897f314dc3ef78e8f5` |
| `artifacts/recovery-final-frozen-tests.log` | 2026-10-28T16:43:44.238720+00:00（mtime） | `a52e320fbe31ad88c56aa8916bf8f891d3e20647f8dc654b30e03550a26c437f` |
| `artifacts/recovery-final-shutdown.log` | 2026-10-28T16:41:52.295903+00:00（mtime） | `c6ad458ca9dac7cafa13315e557c8b6bc11e09cc412b3d4e1ce0373f00d46544` |
| `artifacts/recovery-latest-manager.log` | 2026-10-28T19:02:26.448382+00:00（mtime） | `361acf7cf3a64e3c545b0f8c7a2030ea8795849c4ca7a3e636b8abebd27567a8` |
| `artifacts/recovery-final-guarded-integration.log` | 2026-10-28T19:03:11.532604+00:00（mtime） | `449cde54eeea03071983e825ab317d11f88f583dd51d9c0dc5da5904b41b4b71` |
| `artifacts/recovery-guarded-integration-db-start-failure.log` | 2026-10-28T18:58:23.814988+00:00（mtime） | `c438c563f848d5642f73f9485d25c41f95f6c5eeeda7c1d3769b398bb2aa9a1a` |
| `artifacts/recovery-browser-503-final.log` | 2026-10-28T16:25:40.900615+00:00（mtime） | `8b6276ea18199332f36eef3e35b329ff983de8f1f8412f1a423f706d4798d3ae` |
| `artifacts/recovery-v2-dry.log` | 2026-10-28T16:29:27.201402+00:00（mtime） | `b2e5093e63c6168e23ccac00ebf4196df8b78418433bf59d4610f985a79c4954` |
| `artifacts/recovery-v2-mock.log` | 2026-10-28T16:29:28.283448+00:00（mtime） | `7b9567311e6c3e9bbdaae0a254d6097127b4a14dd3e4e35ef0da1ac340da5427` |
| `artifacts/recovery-legacy-eval.log` | 2026-10-28T16:29:31.835210+00:00（mtime） | `d0c7d0fbb26f45bb9c69860ce5ed70e36dd5221f1f6041cff540c2e63f7e0a24` |
| `artifacts/recovery-hospital-eval.log` | 2026-10-28T16:29:30.386384+00:00（mtime） | `0d0ec93c599442df08ce36cddf7923b2559d648d9058c24b1cc6199f99bdf077` |
| `artifacts/recovery-knowledge-eval.log` | 2026-10-28T16:29:31.373079+00:00（mtime） | `177cd39d4f039ef82b9c180f0c7b98b776273e2da7e17e113ed84d048137a010` |
| `artifacts/recovery-readonly-latest-vps.log` | 2026-10-28T19:04:09.898260+00:00（mtime） | `a5d27c318b6f9fc4a3ffa80df0bd6df1c25d49e20c51da2393df63781d10c28e` |
| `artifacts/recovery-public-browser.json` | 2026-10-28T16:26:33.282Z | `eefd9dc4e451feb65c7e351e686976bd09cd73503323af1abc66cb480fc4f277` |
| `artifacts/recovery-latest-health.headers` | 2026-10-28T19:04:10.271499+00:00（mtime） | `e76ba1800dba5336d33776b19a81a9d2b34676cfed7a3871aec1123ec75a99f3` |
| `artifacts/recovery-latest-health.json` | 2026-10-28T19:04:10.271665+00:00（mtime） | `15944cca78ed4d6849a80c9a91c2239aaf65aa9c8aff97e03d9284402be568f8` |
| `artifacts/recovery-latest-ready.json` | 2026-10-28T19:04:10.422227+00:00（mtime） | `55e02d995180155ca5f78e77a5474c9d39930c7935f2f1c57cdc1f23b3980fea` |
| `artifacts/recovery-ai-studio.json` | 2026-10-28T16:33:27.944556+00:00（mtime） | `5ef98c31099245718bfb52d369e20ebfd0e8d6f38953c71c65400e0fd15c9be9` |
| `artifacts/recovery-build.log` | 2026-10-28T16:24:07.331646+00:00（mtime） | `1e7a59175a279aa4eb42638f0a7334fece29116396cf85c9c23c21ec54ab711e` |
| `artifacts/recovery-typecheck.log` | 2026-10-28T16:29:28.523141+00:00（mtime） | `bcd01820acb4c2c7aaa2c5ad7b59ea804954cf071853a72e39f22738c29bc9e2` |
| `artifacts/recovery-lint.log` | 2026-10-28T16:23:49.652703+00:00（mtime） | `175f844d2f68f6f4c30881cdfaf6f0905ee44aa3c0d40278e20355c9a63a82a5` |
| `artifacts/local-recovery-failed-ready-recovered-1793214182386822000.json` | 2026-10-28T19:03:02.527448+00:00 | `eb2e530116bf3eab962504303a274a2e8a74a91d7865533a725c83542fdab0d8` |
| `artifacts/local-recovery-failed-start-recovered-1793214185809864000.json` | 2026-10-28T19:03:05.862875+00:00 | `187358718c9ffcb0dcb0827d6f040e05f9dd1a953202102c059b75e1f5da1290` |
| `artifacts/local-recovery-success-rollback-1793214191477630000.json` | 2026-10-28T19:03:11.521292+00:00 | `58d686e70043c44fe19f5bcc99a718ff3a97ead07fc451b70b72bc7c072681a8` |

## 最終分類

- 已實作：503分類、Graceful shutdown、冷卻/互斥/指標分離/一次恢復與保留失敗報告。
- 已通過離線：本輪372 Backend、86 Frontend、18部署unit、4本機process/Mongo整合、503 Browser1、凍結Mock/Scorer與本地Evaluation。
- 已通過真實Atlas/Browser：歷史16/16與8/8有來源；本輪新增的是無資料變更的TLS/ping/ready與5頁唯讀Browser。
- 已通過真正Gemini：本輪沒有。上一輪真實I21為503失敗，歷史其他成功不搬到新版分母。
- 尚未驗證：新unit/api-current layout在VPS、真實重啟/回滾、iPhone實機、SMTP與新Live文件品質。
- 需要授權：新的生成預算、正式維護窗口/切換/回滾；Atlas角色等變更本輪不處理。
