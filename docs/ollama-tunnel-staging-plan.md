# NAVI → 家中 Ollama：安全 Reverse Tunnel Staging 設計

2026-10-30，設計基準 `6bc1a90d49a50344d4fde89b873bcbf622faeb38`。**本輪未 SSH、未建立帳號／Tunnel、未變更任一主機。以下設定及命令均是待審閱提案，不能直接當成已驗收部署腳本。**

雙模型更新：同一私有通道承載 Text 與 Vision，Gateway 依後端操作選固定模型，禁止訪客或 Agent 任意選 tag；兩者共用 GPU 排程。先測既有 Qwen3.5，再比較 Qwen3-VL，詳細見 [視覺測試計畫](ollama-vision-evaluation-plan.md)。不新增公開 Vision Port。

只規劃新 VPS `207.148.113.119` 與使用者的家中 Ubuntu。不得連線或修改舊 VPS。家中地址、SSH 路徑、實際 Ollama／OS 版本及 Adrift 拓樸尚未核實，不猜測或掃描。

## 1. 連線方向與界線

```text
Internet Browser
  └─既有 HTTPS NAVI → VPS Express（原有 owner / Session / 上傳防護）
      └─NAVI mTLS Client → VPS 127.0.0.1:19134（候選私有 Port）
          ═ SSH -R，由家中主動連到 VPS ═
              家中 127.0.0.1:11435（候選 NAVI 專用 HTTPS Gateway）
                  ├─有界本地 PDF / Render / OCR 核對 Worker
                  └─家中 127.0.0.1:11434（Text / Vision，共用 Ollama，不改監聽）
```

兩個新增 Port 需先查占用，本輪沒有保留／測試。Nginx 不新增 Gateway 公開路由，防火牆不開 11434／11435／19134；Ollama 不綁 `0.0.0.0`，家中不需開入站 Port 或 Router Port Forward。

不能直接用 `-R ...:11434` 就稱安全隔離。[Ollama 本地 API 不要求驗證](https://docs.ollama.com/api/authentication)，而 VPS Loopback 上的其他本機程序也可能連線。因此新增小型 NAVI Gateway：mTLS 驗證 Express、限制模型／路徑／大小／並發；SSH 僅傳輸這條 TLS 流量，不代理整個 Ollama 管理 API。

威脅範圍包括公開訪客偽造參數、VPS 其他本機使用者連私有 Port、SSH Key 誤用、偽造 Tunnel Upstream、惡意文件及工作資源耗盡。VPS／家中 root 已遭入侵不在單條 Tunnel 能完整防禦的範圍，不承諾可抵禦主機完全失陷。

## 2. 帳號、Key、憑證及路徑

| 位置 | 資源／權限提案 |
|---|---|
| VPS | `navi-ollama-tunnel` 專用帳號，無 sudo／docker／lxd／其他專案群組；只允許固定 remote forwarding，無 shell／PTY／SFTP Session |
| 家中 | `navi-tunnel-client` 執行 SSH，Key 與 pinned known_hosts 私有；NAVI Gateway／OCR 用另一個無管理權限帳號，不取得 Adrift 目錄或控制權 |
| SSH Key | 新 NAVI 專用 Key，不重用 root 部署 Key 或 Adrift Key。VPS authorized_keys 由 root 管理，不讓 Tunnel 帳號修改 |
| TLS | NAVI 私有 CA、Gateway Server Certificate（SAN `navi-inference.internal`）、Express Client Certificate。私鑰與 SSH Key 分開；Gateway 必須驗 Client CA／用途與核准身分 |
| Express | 使用 Node 內建 HTTPS 的指定 CA、SNI／Server Identity、Client cert／key，驗證憑證；不設 `rejectUnauthorized:false` 或全域關閉 TLS |
| 檔案 | VPS `/opt/navi-hackathon` 的 NAVI 私有子目錄、家中獨立 `/opt/navi-inference`；Key／環境檔 0600，父目錄限制存取。額外 systemd／sshd drop-in 等路徑逐筆記 manifest |

每個 Key／Certificate 記用途、指紋、有效期與撤銷方式，不記私鑰。用 mTLS 保護，即使錯誤程序搶到 VPS 私有 Port，Express 也不接受假的 Gateway。輪替及撤銷先做 Staging，不修改既有服務密鑰。

## 3. OpenSSH 最小權限提案

先核對目標 Ubuntu 的 OpenSSH 版本／PAM／現有 Match 規則，再以該主機 `sshd -t` 及 `sshd -T -C user=...,host=...,addr=...` 驗證實際生效設定。以下僅針對專用帳號，不能全域放寬：

```text
Match User navi-ollama-tunnel
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding remote
    PermitListen 127.0.0.1:19134
    PermitOpen none
    GatewayPorts no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    MaxSessions 0
    AllowStreamLocalForwarding no
    PermitTunnel no
    AuthorizedKeysFile /opt/navi-hackathon/config/ollama-tunnel.authorized_keys
```

專用 authorized key 的候選限制（後接專用公鑰，不在文件存真實 Key）：

```text
restrict,port-forwarding,permitlisten="127.0.0.1:19134" <dedicated-public-key>
```

依 [sshd_config](https://man.openbsd.org/sshd_config)與 [authorized_keys](https://man.openbsd.org/sshd.8)說明：

- `PermitListen` 限制 VPS 的 remote listener；`MaxSessions 0` 保留 forwarding 但禁止 shell／login／subsystem Session。
- `PermitOpen` 是 direct／local forwarding 目的地限制，**不能用它宣稱已限制家中 `-R` 的 target**。後者還需受控家中命令、專用 Key、Gateway mTLS 與固定服務路徑。
- `restrict` 之後只恢復所需 forwarding，帳號 Match 再限制 remote-only；實際安裝版是否支持這些組合必須測試。
- nologin／鎖定帳號在不同 PAM／sshd 設定可能連 forwarding 都拒絕；先驗證專用帳號，不為了成功而開 shell／密碼或鬆綁其他帳號。

家中服務執行的命令草案：

```sh
ssh -NT \
  -i <NAVI-private-key-file> \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=<NAVI-pinned-known-hosts-file> \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:19134:127.0.0.1:11435 \
  navi-ollama-tunnel@207.148.113.119
```

Host Key 從可信管道核對指紋，不使用單純 `ssh-keyscan` 輸出即視為已信任，不用 StrictHostKeyChecking=no。這不是本輪要執行的命令。

## 4. Gateway 與模型資格檢查

- Gateway 僅讓核准 Client 呼叫白名單：本機模型 metadata、受限 Text Chat、Vision 頁面觀察、NAVI 文件 Job。操作分別綁 Text／選定 Vision 的固定 digest；Staging 比較模型另由管理設定指定。限制 body／解碼後圖像／response／工作時間、Schema 與產生參數；拒絕訪客指定的 model、URL、options、工具清單及檔案路徑。
- 不代理 `/api/pull`、push、create、delete、copy、管理設定、Web Search 或其他 Cloud 功能。模型已安裝才可用，不自動下載、不因失敗切模型。模型卸載若有需求，只能由家中受控 Scheduler 在共同排程確認無其他使用者後處理 NAVI 獨占模型；不將管理能力暴露給 Browser／Agent／一般 Gateway API。
- Staging 只用 metadata 驗證 [version](https://docs.ollama.com/api-reference/get-version)、[show](https://docs.ollama.com/api-reference/show-model-details)及 [ps](https://docs.ollama.com/api/ps)，並由 `/api/tags` 取得安裝模型的完整 digest；不以 metadata check 暗中執行生成。記模型宣告能力及實際 Ollama 版本。Gateway 只投影核准 NAVI 模型的必要欄位，不公開 Adrift 模型清單、Modelfile、System Prompt 或完整模板。
- 指定 Text tag 的 Structured Output／工具、Vision tag 的實際 image＋Schema 能力仍需真實本地評測。`/api/ps` 看得見載入模型不等於 GPU 可接納 NAVI 工作；新模型載入也可能驅逐 Adrift，因此模型安裝／載入／卸載都要納入共同驗收窗口。
- [Ollama FAQ](https://docs.ollama.com/faq)提供停用 Cloud 的設定；共享 Daemon 是否能停用必須先與 Adrift 擁有者核對。本輪不改全域環境、模型或網路。Gateway 先拒絕 Cloud 路徑／模型，另核對實際本地模型請求沒有雲端流量；無法證明時不能正式切換。

Gateway／Worker 的 timeout、資源限制、檔案暫存清理與敏感 Log 防護見 [Pipeline 設計](ollama-migration-design.md#4-完全本地文件-pipeline)。SSH Key 不給 Gateway 進程，模型也不能要求 SSH、HTTP 或任意檔案操作。

## 5. 斷線、重連及健康狀態

家中 Tunnel 用專屬 systemd Service，候選 `Restart=on-failure`、`RestartSec=60s`、`StartLimitIntervalSec=300`／`StartLimitBurst=6`；不改 NAVI API 或 Adrift 的 StartLimit，不用無限緊密重啟。以上值尚未安裝／量測。

Keepalive 15 秒 × 3 是候選偵測條件，不是確定 45 秒恢復；還有網路、DNS、SSH、服務冷卻與 TLS。報告須分「偵測斷線／Tunnel 重建／metadata 可用／首次任務成功」的實際時間，不宣稱達成 RTO。

健康分層：SSH 存活 → Gateway mTLS／授權可用 → 固定模型 metadata 可用 → CPU／GPU 工作可接納 → 真正任務結果。前一項不證明後一項。背景健康檢查不生成、不預熱，不因 Tunnel 壞掉反覆重啟 Express／MongoDB／Ollama。

呼叫逾時、中止、Circuit open、Queue 滿均回既有明確錯誤；可信 Knowledge 保持可用。斷線後不把同筆可能已執行的生成自動再送，不切回 Gemini。沒有生成的文件保持未分析／需確認。

## 6. 隔離驗收矩陣

先以本機隔離 sshd、假 TLS Upstream、合成 bytes 完成正負測試；後續**取得兩主機變更授權後**才做實際兩主機 Staging。Tunnel 驗收本身不需模型生成。

| 案例 | 預期與證據 |
|---|---|
| 專用 Key／Client cert 正常 | 只由 VPS Loopback 經 Tunnel 取得假 Upstream／模型 metadata，記時間與指紋，不記密鑰 |
| 外部連線私有 Port | 從外部連不到；VPS `ss` 確認無 `0.0.0.0`／IPv6 公開 listener，Nginx 未代理 |
| VPS 本機其他程序 | 無 Client cert／錯 CA／撤銷身分／過期 cert 均被 Gateway 拒絕 |
| 假 Gateway／錯 Server cert | Express 驗證失敗，不接受假結果、不關閉 TLS 驗證 |
| 其他 Remote Port／公開 Bind／`-L`／`-D` | 均拒絕；記實際生效的 sshd Match，不只檢查設定文字 |
| Shell／PTY／SFTP／Agent／X11／StreamLocal／Tun | 專用帳號不能取得這些權限，無管理群組與其他專案寫權 |
| Port 被占用／Host Key 改變 | ExitOnForwardFailure／Host Key 驗證失敗；不搶 Port、不忽略指紋 |
| 關閉測試 Tunnel／網路黑洞 | 有界 Timeout／Keepalive＋退避，記恢復各階段時間；不在 Production 拔線 |
| Gateway／OCR 故障但 SSH 尚存 | AI 狀態不可用／工作失敗，不誤報健康，不增 readiness |
| Ollama metadata 不可用／模型 digest 改變 | 拒絕新任務／標待確認，不拉模型、改 tag 或切外部 Provider |
| Request 取消／重複 requestId | 下游取消、清理暫存；不自動重送生成、不重複建 Journey |
| Adrift 同時使用 | 先取得共同排程／驗收時段，低量逐步測，觀測基準與資源；未完成不能宣稱零影響 |

## 7. 授權、部署及撤除 Gate

本輪交付設計，不操作新 VPS、家中主機或現有正式 AI。下一步需要使用者確認 Staging 範圍：兩主機專用帳號、指定路徑、sshd 帳號 Match、mTLS 憑證、Gateway／Worker／Tunnel Service，以及 Adrift 協調窗口。不得把先前其他部署授權延伸成此次正式 Provider 切換授權。

實作後所有 NAVI 新增資源寫入 manifest：主機／帳號／Key 指紋／Certificate 指紋／檔案／Port／unit／sshd drop-in／暫存路徑及移除順序。撤除先停 NAVI 工作、關 Tunnel、驗證 PID／Marker／歸屬，再清專用資源；不刪共享 Ollama／模型／Adrift／原有 NAVI Release 或其他系統帳號。未知資源保留回報。

正式 Cutover 另需完整 Provider／OCR／Agent 品質、安全、Browser E2E、Adrift 並行及 Rollback Gate，見 [分階段 PR](ollama-migration-design.md#7-分階段-pr-與停止條件)。本設計不能作為「Tunnel 已驗收／正式推論已改 Ollama」的證據。
