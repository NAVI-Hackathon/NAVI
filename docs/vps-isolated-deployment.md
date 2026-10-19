# NAVI 隔離式 VPS 部署

本部署只供 SSH Tunnel、合成資料與 Demo Provider 展示，不是公開醫療資料服務。未修改兩個網站的 UI、共用契約或工作流程，也沒有新增 npm 依賴。

## 本次結果：安全停止，尚未完整驗收

應用程式固定於 `38934f45ccc96e3047f7c2ab969537150052a005`。三個服務曾成功啟動，健康檢查、嵌入式查詢、地址變更「帶我去」與住院初始 35% 通過。其後記憶體守門程序在 **2026-10-20 02:20:48（台灣時間）** 觸發並停止 NAVI；未放寬門檻或重新啟動。VPS 文件上傳至 100%、reload、手機完整流程尚未驗收。

第一次守門程序只記錄複合記憶體／OOM／PSI 錯誤，未保留觸發瞬間數值，因此不能精確歸因。系統與 cgroup 的 OOM 為 0；後續受限的移除 Dry Run 期間，cgroup `memory.events max` 增加至 198，代表曾觸及限制，不代表發生 OOM。停止後另一次唯讀觀察仍出現 PSI full avg10 1.26%，無法將壓力單獨歸因於 NAVI。新版守門程序會保存具數值的安全停止原因。**不能將本次結果視為三服務可在此主機穩定運作的證明。**

既有 Nginx、PM2、SSH 與應用程式監聽 PID 維持不變。Nginx `/` 回應 200；既有應用程式 `/` 回應 404，未測試其業務流程，也沒有已知的部署前 HTTP 狀態可比較。完整私人盤點保留在 VPS 的 `config/`，不提交其他專案清單。

## 隔離邊界

```text
/opt/navi-hackathon/
  .navi-deployment-marker         root-only 識別 Marker
  deployment-manifest.json        帳號、release、限制、暫存系統資源及驗收狀態
  runtime/node                   專屬官方 Node，非系統 Node
  runtime/incoming/              校驗後的部署封包
  releases/<sha12>-<epoch>/      API 原始碼／Linux API 依賴／靜態網站
  current -> releases/...
  previous -> releases/...       有更新時才建立
  config/                        環境、部署前基線及結果，root-only
  logs/                          NAVI 專用日誌
  run/                           PID 識別、TMP、npm cache
  scripts/                       本目錄部署管理工具
```

專用系統帳號 `navi-hackathon`，shell `/usr/sbin/nologin`、密碼鎖定、僅專用群組。帳號與程式碼沒有其他專案寫入權。網路程序使用該帳號、清空 capabilities、`NoNewPrivileges`、唯讀系統、隱藏 home／其他專案路徑，只准寫 NAVI TMP，出站限制在 loopback。

專案檔案全部在 `/opt/navi-hackathon`；必要例外為 manifest 列出的 **NAVI 專屬暫時性 systemd unit、slice drop-in 與 cgroup**，以及核准的系統帳號資料。沒有新增 `/etc` 開機單元，沒有修改系統 PATH、Node、代理、防火牆、SSH、Swap 或其他服務。共用系統稽核日誌不會清除。

## Build 與 Runtime

- 官方 Node **22.23.3 linux-x64**，使用官方 `SHASUMS256.txt` 驗證 SHA256，位於專案內。系統 Node 20 保留。
- `scripts/deploy/build-artifact.py` 在 VPS 外從指定 Git commit 建立乾淨來源、執行 `npm ci` 與 `npm run build:all`。需要支援 tarfile data filter 的 Python 及符合專案要求的 Node。
- Vite 為靜態 dist；Mock Website 沒有必要的伺服器功能，可在**封包建置副本**加入 Next `output: "export"`，原專案設定不變。所有保留頁面由兩個輕量 Node 靜態伺服器分別提供，並保留 Next RSC `.txt`、clean route、404、嵌入導航。
- macOS 只產出平台無關的 HTML/CSS/瀏覽器 JS。封包不含 `node_modules`。
- API production dependencies 在 Ubuntu x64 上，用專屬 Node 與 root lockfile 執行選定 workspace 的 `npm ci --omit=dev --ignore-scripts`；沒有 Next runtime 或 `.node` 原生模組。不在 VPS 執行 Next Build。
- Web `/api` 由部署內的小型 HTTP proxy 轉給 API；不修改系統 Nginx。
- 封包及 SHA256 位於本機 Build 輸出目錄；部署後 `release.json`、`release-ready.json`、manifest 記錄來源 SHA 與工具雜湊。

已驗證的封包 SHA256：
`91f31ba170f3b0118d833d51235da238c1cf64049ec5ec03c2fbcc778c8cf7fe`

## 資源與安全停止

只設定 `navihackathon.slice`：整體 **CPU 25%、MemoryHigh 192 MiB、MemoryMax 224 MiB、Swap 0、TasksMax 96**。API 子限制 112 MiB、靜態伺服器各 64 MiB，仍共同受 parent 224 MiB 約束；不能將子限制相加視為額外可用記憶體。

守門程序每約 3 秒檢查可用記憶體、PSI、系統／cgroup OOM、cgroup high/max 事件，以及部署前既有服務與監聽 PID。門檻為 MemAvailable 250 MiB、PSI some avg10 5%、full avg10 1%。超過任一條件會停止 NAVI。網路服務 `BindsTo` 守門程序；守門程序退出時也停止。這是事後偵測與硬限制，不是其他服務完全零影響的保證。

不自動重啟，不設開機啟動；VPS 重開機後服務維持關閉。若發生安全停止，先分析 `logs/guard.log`、`logs/safety-stop.json`、`logs/resources.jsonl`、cgroup events 與 `config/deployment-result.json`。**不得直接放寬門檻、清除壓力紀錄或反覆嘗試啟動。** 本次維持 `safety-stopped`，不繼續 VPS 驗收。

## SSH Tunnel

以下僅為之後經資源安全確認、人工重新啟動後的操作方式；目前三埠沒有服務監聽。Mac 埠需相同，否則會破壞編譯時精確 origin 白名單。

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:18171:127.0.0.1:18171 \
  -L 127.0.0.1:18172:127.0.0.1:18172 \
  -L 127.0.0.1:18173:127.0.0.1:18173 root@<VPS_HOST>
```

| 服務 | Tunnel 網址 |
| --- | --- |
| NAVI Web | http://127.0.0.1:18171/ |
| API Health | http://127.0.0.1:18172/api/health |
| Mock Website | http://127.0.0.1:18173/ |
| 前端本地 Mock 備案 | http://127.0.0.1:18171/demo |

統一使用 `127.0.0.1`，不能換 `localhost`。`/demo` 不依賴 API，但仍需要 Web 服務存活；所有 NAVI 停止時無法作為 VPS 備案，可用 Mac 的 `npm run dev:all` 展示。不要輸入真實病歷、姓名或帳號。

## 管理方式

下列指令均在 VPS 執行，僅適用已初始化且 Marker 相符的本部署，並非通用主機安裝器。

```sh
# 唯讀狀態，安全停止時仍會顯示服務狀態與警告
/opt/navi-hackathon/scripts/status-navi.sh
# 停止 NAVI，不停止其他專案
/opt/navi-hackathon/scripts/stop-navi.sh
```

只有在資源問題排除並經人工決定恢復後，才使用 `start-navi.sh` 依序啟動。腳本仍會拒絕低記憶體、壓力事件、保護程序變化或埠占用。歷史 cgroup high/max 事件不會被腳本自行清零，需先保留證據並另行評估；本次沒有執行恢復。

更新流程（不是自動部署）：

```sh
# Mac／建置機；使用全新輸出目錄
python3 scripts/deploy/build-artifact.py --revision <commit> --output <new-build-directory>
# 將封包傳至 VPS /opt/navi-hackathon/runtime/incoming/，先核對 SHA256
# VPS：只安裝封包，不啟用更新後的 release
/opt/navi-hackathon/scripts/deploy-navi.sh /opt/navi-hackathon/runtime/incoming/<artifact.tar.gz> <sha256>
# 人工確認資源安全後才啟用；失敗會嘗試恢復原 release，安全守門仍有效
/opt/navi-hackathon/scripts/update-navi.sh /opt/navi-hackathon/releases/<validated-release>
# 若已有 previous，可人工回復；本次只有一個 release，沒有執行更新／回復驗收
/opt/navi-hackathon/scripts/rollback-navi.sh
```

## 完全移除

```sh
# 預設 Dry Run，已在本部署驗證；不停止、不刪除
/opt/navi-hackathon/scripts/remove-navi.sh
# 賽後人工決定執行；本次禁止且未執行
/opt/navi-hackathon/scripts/remove-navi.sh --confirm
```

工具檢查固定根目錄、root-only Marker、部署 UUID、unit description、執行檔／UID、目錄與 symlink 邊界、專用帳號群組、額外程序和 root filesystem 的帳號檔案依賴。拒絕不明設定／帳號識別碼重用。確認後才會停止驗證過的 NAVI units、撤回 NAVI slice 的暫時設定、刪除專用帳號與整個部署目錄。若中途失敗，保留 Marker；可在未重用 UID/GID 的前提下重新檢查並續行。全域系統日誌刻意保留，不宣稱抹除系統稽核痕跡。

## 驗證紀錄

在應用 SHA 的乾淨 `git archive` + `npm ci` 環境（官方 Node 22.23.3）執行，而非使用既有本機未更新依賴：

| 項目 | 結果 |
| --- | --- |
| `npm test` | Web 31/31、API 127/127，共 158/158 |
| `npm run build:all` | 通過，Mock 使用 export 建置副本 |
| `npm run lint` | 通過 |
| 本地 Legacy／住院／知識 evaluation | 120/120、76/76、96/96 |
| 部署靜態伺服器測試 | 3/3 |
| 部署管理安全測試 | 8/8 |
| VPS 三服務啟動／health | 一度通過，現已安全停止 |
| SSH Tunnel 嵌入、地址導航／高亮 | 通過 |
| VPS 住院完整 35→70→90→100 | 只驗收到 35%，未完成 |
| VPS 手機完整流程／移除後重新部署 | 未完成／未執行 |
| 移除 Dry Run | 通過，真正移除未執行 |
| Live Gemini／新付費依賴 | 0／0 |

資源基線 MemAvailable 約 559 MiB；正常取樣最低 486.3 MiB（不代表觸發瞬間最低值），停止後約 524–540 MiB。既有 Swap 本來存在，沒有建立或調整。

目前建議先維持 VPS 停止，直接用 Mac 本地 Demo 作為零成本展示方案。若要恢復 VPS，需要先釐清壓力來源及負載餘裕，不能以放寬上限換取啟動成功。
