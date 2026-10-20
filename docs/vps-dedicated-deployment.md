# NAVI 專用 VPS 公開 Demo 部署

驗收日期：2026-10-20（台灣時間）。此為 production build + Demo Provider 的 **HTTP 合成資料展示環境**，不是正式理賠送件入口。

## 公開入口

| 用途 | 網址 |
| --- | --- |
| 模擬保險官網／嵌入式 NAVI | http://207.148.113.119/ |
| NAVI Web | http://207.148.113.119:8080/ |
| API Health（經 Nginx） | http://207.148.113.119:8080/api/health |
| API 故障時的本地備援 | http://207.148.113.119:8080/demo |

展示順序：開模擬官網 → 右下 NAVI → 輸入「我上週在台中榮總住院五天，要怎麼申請理賠？」→ 35% → 合成診斷 PDF 70% → 合成存摺 PDF 90% → 確認示範資料與申請書 100%。「帶我去」僅導航模擬站、選取分頁及高亮，沒有真正送出申請。

## 實際架構

- Ubuntu 24.04.5 LTS、x86_64、1 vCPU、約 955 MiB RAM。
- 官方 Node.js **22.23.3 linux-x64**、ABI127，在 `/opt/navi-hackathon/runtime/node`；已核對官方 SHA256。沒有 Node24 或全域 npm 安裝。
- Nginx **1.24.0（Ubuntu 安全更新套件）** 提供兩站靜態檔案，Express 是唯一常駐 Node 程序。
- Mock Website 在 Mac 的乾淨來源副本加入 Next `output: "export"`，沒有修改原本 Next 設定。保留 RSC `.txt` 回應類型、深連結、iframe、分頁、定位及高亮。
- API production dependencies 在 Ubuntu 使用 root lockfile、Node22 執行選定 workspace 的 `npm ci --omit=dev --ignore-scripts`；不傳送 Mac node_modules，也沒有 Next server 或原生 `.node` 模組。
- 應用產物來源：`7329f62ba2613064a2ce52a453dace5cbd3c1cf5`。後續部署工具與文件提交不會自動切換已驗收的應用產物。

```text
/opt/navi-hackathon/
  .dedicated-marker.json       root-only、帳號識別及精確 origins
  runtime/node                私有官方 Node22
  incoming/                   checksum 驗證的封包
  releases/<sha12>-<epoch>/    靜態雙站、API、shared、knowledge、資料及 Linux API 依賴
  current -> releases/...
  previous -> releases/...
  config/api.env              root600，沒有 Gemini Key
  config/deployment.json      版本／帳號／服務／設定檔雜湊
  scripts/manage.py           本次專用 VPS 管理工具
  run/                        專用帳號可寫的 TMP／npm cache
```

帳號 `navi-hackathon` 為系統 non-login 帳號，本次 UID999／GID988，只有自身群組。程式碼及可啟用的 ready marker 由 root 持有；未完成安裝、marker 可寫或 symlink 越界的 release 不可啟用。歷史 release 不自動清除。

## Nginx、systemd 與環境

Nginx 設定：`/etc/nginx/sites-available/navi`，對應 `sites-enabled/navi`。專案範本在 `scripts/deploy/dedicated/nginx.conf`。80 為 Mock、8080 為 Web；`/api/` 保留原 URI 反向代理至 **127.0.0.1:18172**。UFW 保留 SSH22，只額外允許80／8080；18172 不公開。

編譯時 origins 精確固定為 `http://207.148.113.119` 與 `http://207.148.113.119:8080`，postMessage 的 origin、source window 與導航白名單未放寬；CSP 只允許指定模擬站嵌入。不要將網址改成 localhost、任意 DNS alias 或其他 port；更換網域時需重新編譯及同步設定。

`navi-api.service` 位於 `/etc/systemd/system/navi-api.service`，範本同名放在 `scripts/deploy/dedicated/`。Nginx 與 API 都已啟用開機啟動。API 非 root、readonly system、無 capabilities、出站限 loopback，僅 run 可寫。Node heap192MiB、MemoryHigh384MiB、MemoryMax512MiB、TasksMax64；沒有舊共享 VPS 的 CPU25%／整體224MiB限制或短暫壓力自動關站 Guard。

API `Restart=on-failure`、間隔5秒、300秒最多3次啟動，避免失敗迴圈。手動 stop 不會自動拉起；修復錯誤後再恢復，不要盲目重試。

`config/api.env`：

```dotenv
NODE_ENV=production
AI_MODE=demo
ALLOW_PAID_AI=false
CI=true
GEMINI_API_KEY=
GEMINI_FREE_TIER_CONFIRMED=false
TRUST_PROXY_LOOPBACK=true
HOST=127.0.0.1
PORT=18172
WEB_ORIGINS=http://207.148.113.119:8080,http://207.148.113.119
TMPDIR=/opt/navi-hackathon/run
```

`--demo` 另在 systemd ExecStart 固定。Nginx 覆寫 X-Forwarded-For 為實際 remote address；Backend 僅在明確設定時信任 loopback proxy，避免信任外部偽造代理。API 每來源30次／分鐘，Health 不計入。上傳上限仍為10MB；Nginx 不緩衝上傳 body，應用不保存檔案本身。Access log 不含 query/body；共用錯誤日誌仍可能記錄網路診斷資料。

## 建置、部署與更新

本文件只針對已初始化的專用 VPS。**不要執行舊 `manage-navi.py`／`install-release.py` 隔離主機工具。** 新管理器會檢查 dedicated Marker、帳號與目錄，不會安裝 OS 或調整 UFW。

在 Mac／建置機確認 Node22 與支援 tar data filter 的 Python，使用全新輸出目錄：

```sh
git fetch origin
npm ci
npm test
npm run lint
python3 scripts/deploy/build-artifact.py \
  --revision origin/main \
  --web-origin http://207.148.113.119:8080 \
  --mock-origin http://207.148.113.119 \
  --output <new-build-directory>
```

Build 會自行建立來源副本並執行 `npm ci`、`npm run build:all`；前端只使用公開 origins，沒有 Secret。VPS 不執行 Next Build。以指定金鑰傳送剛產生的封包：

```sh
scp -i ~/.ssh/navi_vps -o IdentitiesOnly=yes <artifact.tar.gz> \
  root@207.148.113.119:/opt/navi-hackathon/incoming/
ssh -i ~/.ssh/navi_vps -o IdentitiesOnly=yes root@207.148.113.119
```

以下在 VPS 執行。SHA256 使用 Build 輸出值；安裝不會啟用新 release，成功後最後一行是已驗證目錄：

```sh
python3 /opt/navi-hackathon/scripts/manage.py install \
  /opt/navi-hackathon/incoming/<artifact.tar.gz> <sha256>
python3 /opt/navi-hackathon/scripts/manage.py activate <validated-release-path>
```

管理器驗證封包路徑、雜湊、來源 SHA、origins、archive 邊界，再安裝 Linux API 依賴、封存權限及建立 ready marker。啟用時檢查 Nginx，原子切換 current、重啟 API、通過 Health 後 reload Nginx；失敗嘗試恢復原 release。只回復應用產物，不自動回復人工修改的 OS／環境設定。

## 管理與日誌

```sh
# 以下皆在 VPS 執行
python3 /opt/navi-hackathon/scripts/manage.py status
python3 /opt/navi-hackathon/scripts/manage.py restart
python3 /opt/navi-hackathon/scripts/manage.py stop      # 只停 API，靜態網站／demo 保留
python3 /opt/navi-hackathon/scripts/manage.py rollback  # 啟用 previous

systemctl start nginx navi-api
systemctl stop nginx   # 需要關閉兩個公開靜態站時使用；SSH 不受影響
journalctl -u navi-api.service -f
tail -f /var/log/nginx/navi-error.log
nginx -t
```

本次已實際切換及回復兩個**相同已驗證產物**的 release，驗證 symlink、服務及入口復原。新版本失敗時的回復分支另有單元測試，未刻意破壞公開服務測試 crash loop。

## 實際驗收與資源

| 項目 | 結果 |
| --- | --- |
| 應用 tests | Web32/32、API128/128，共160/160 |
| 部署工具 tests | dedicated4、builder2、舊管理器8、靜態server3，共17/17 |
| Build／Lint | Node22 下通過雙站 Build（Mock export）及 Lint |
| 本地 evaluation | Legacy120/120、住院76/76、Knowledge96/96 |
| 外部 API smoke | 15項通過，含 Intent、35→70→90→100、刪除撤回、重傳、來源導航、400／403／415、兩路讀取 |
| 靜態路由與資源 | 33項HTTP檢查通過，含雙站路由、JS／CSS資源、Next RSC回應類型及404 |
| 完整 JSON HTTP 回應時間 | 18次請求 p50 56.51ms、p95 130.29ms；Mac 至 VPS 的觀察值，非 SLA |
| 兩路並行 Golden Path | 2/2通過，共8個請求，各自35→70→90→100，約380／383ms，不含UI動畫 |
| 外部瀏覽器 | 桌面1440px、手機390px Backend流程、實際檔案選擇器、reload、刪除／重傳及Reset通過 |
| Embed／導航 | Desktop／Mobile跨頁、分頁選取、高亮、手機收合及深連結重新整理通過；console未發現非預期錯誤 |
| API 故障／demo | 實際停止 API 回503 JSON，UI顯示降級說明；API停止期間 `/demo` 獨立完成100%，之後已恢復 |
| Runtime | Nginx RSS約9MiB，Express RSS約77–88MiB；18次取樣 MemAvailable約554–584MiB |
| Swap／OOM | 原本已有2.3GiB Swap，未增建；取樣使用約24–26MiB，OOM與cgroup high/max事件均0、非預期重啟0 |
| Zero-Cost | 0 Gemini、0付費API、0新增npm相依套件；只使用已提供VPS與免費開源部署工具 |

Nginx／API的Stop與Release演練是刻意的驗收操作，不計作非預期重啟。資源數字為短期合成展示取樣，不是長時間壓測。

## 限制

- HTTP、無登入與案件授權，不接受真實醫療、銀行或個人敏感資料；只使用範例或明確合成文件。尚未配置 HTTPS，不能作為安全的正式理賠入口。
- Demo Provider 的 Intent／文件辨識為可重現的合成結果，**不是 Gemini 真實辨識**。Knowledge 是本地 Snapshot；沒有即時爬蟲、RAG 或付費搜尋。
- Journey 仍為 InMemory（上限100案、更新後1小時過期），重啟／更新服務後舊案件會失效；100%只代表原型資料準備完成，沒有送件或核賠。廣泛長期公開前需要重新評估容量／保留期限與實際安全設計。
- `/demo` 的本地資料與 Backend Demo 日期／顯示欄位略有差異，分數與主要旅程相同；保留現有前端備援，未重做 A 的 UI。
- 少數共用 footer 仍沿用本地模式「文件不會被上傳」文案；一般模式實際會將合成檔案傳至 API，文件區已有正確提醒。後續應由 A 對齊此文案；不得據此上傳真實文件。
- 修正 HTTP 的 UUID 相容性時使用 getRandomValues，沒有取消 Origin 驗證或變更瀏覽器安全設定；依據 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)。
- 尚未測試實體手機、HTTPS、長期穩定性及高並行；目前僅通過390px響應式及少量合成請求。
