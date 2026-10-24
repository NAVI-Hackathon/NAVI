# NAVI 自訂網域與 HTTPS

本文件為專用 VPS `207.148.113.119` 的網域遷移操作指南。主程式、UI、Workflow 與 API 契約不變；仍是黑客松合成資料原型，HTTPS 不代表真實送件、核賠或已具備正式個資服務安全設計。

## 網址及建置設定

- `https://navitw.com`：模擬保險官網，保留「InsurHack 模擬網站，非官方」標示。
- `https://www.navitw.com`：308 至主網域，保留路徑與查詢參數。
- `https://app.navitw.com`：NAVI；`/demo`、`/embed`、`/embed?mode=demo` 保留。
- `https://app.navitw.com/api/health`：同來源 API 代理；Express 仍只監聽 `127.0.0.1:18172`。

沿用 `scripts/deploy/build-artifact.py`，在建置機設定 `--web-origin https://app.navitw.com --mock-origin https://navitw.com`。工具在乾淨來源副本設定 `NEXT_PUBLIC_NAVI_EMBED_URL=https://app.navitw.com/embed`、`VITE_MOCK_SITE_URL=https://navitw.com`、`VITE_EMBED_ALLOWED_ORIGINS=https://navitw.com`、`VITE_API_BASE_URL=`。不傳送本機 node_modules 或 API Key。VPS 不執行 Next.js Build。

Backend `WEB_ORIGINS` 最終只保留這兩個 HTTPS origins；既有精確 postMessage origin/source window 驗證與可信導覽白名單不變。Nginx 的 app `frame-ancestors` 僅允許自己與主網域。`www` 先轉址，不需另加入 iframe 白名單。

## DNS、憑證與續期

三個名稱目前經 Cloudflare 代理，因此公開 A/AAAA 回應是 Cloudflare 節點，不是來源 VPS。已使用 VPS 專屬 HTTP 驗證檔逐一確認路由，不能只看 DNS 就斷言來源正確。若改為 DNS-only，A 應指向 `207.148.113.119`，不得留下指向其他主機的 AAAA。

Certbot 使用 Ubuntu 官方套件與 webroot `/opt/navi-hackathon/acme`，憑證名稱 `navitw.com`，涵蓋三個名稱。Nginx 範本：`scripts/deploy/dedicated/nginx-domains.conf`。憑證與私鑰不進 Git。未提供通知信箱，註冊時不設定 email。

HTTP `/.well-known/acme-challenge/` 必須直接提供驗證檔，其餘 HTTP 轉址只在 HTTPS 實測成功後啟用。[Let's Encrypt HTTP-01](https://letsencrypt.org/docs/challenge-types/) 使用 port80；維持80開啟供續期。Cloudflare 若使用代理，應使用 Full (strict)，避免 Flexible 與來源強制 HTTPS 形成轉址迴圈；本地來源憑證有效不能取代對 Cloudflare 設定的確認。

Ubuntu `certbot.timer` 執行續期；`/etc/letsencrypt/renewal-hooks/deploy/navi-reload-nginx` 在成功更新後執行 `nginx -t && systemctl reload nginx`。以 `certbot renew --cert-name navitw.com --dry-run` 驗證挑戰流程，再測試 deploy hook。dry-run 使用 staging，不是新的正式憑證。

## 遷移與復原

1. 備份原 IP Nginx、API env、dedicated marker 與 deployment manifest 至 `/opt/navi-hackathon/config/domain-migration/`，root-only。
2. 新增精確網域 HTTP ACME server；既有 IP 80/8080 不變。驗證三個名稱，再簽發憑證。
3. 本機以最新已測 main 建置 HTTPS origins 產物。保留舊 release；marker origins 改為新 origins 後，既有 manager 才能驗證安裝新產物。
4. 初期 HTTPS server 指向新 release 的明確路徑，原 IP 指向舊 release。Backend 過渡期允許舊 IP 和新 HTTPS origins，保留精確名單。HTTPS、API、iframe 與導覽通過後，切換 current。
5. 完整驗收後，HTTP 舊 IP 入口轉往對應 HTTPS 網域，8080 保留為舊連結轉址入口；不再提供舊 HTTP app。最終 Backend 移除舊 origins。HTTPS Nginx root 回到 current，供既有更新工具管理。
6. 應用之後更新仍以 manager 的 install/activate/rollback 執行；只選用相同 HTTPS origins 的 release。**跨回 IP 版本的首次遷移不能只執行一般 rollback**：需使用本次保存的 env、marker、Nginx 設定與舊 release 一起復原，再通過 `nginx -t`／health 才 reload。

完整首次遷移復原腳本與驗收紀錄保存在 VPS 專案目錄及本機部署 artifact，不含私鑰。不要刪除原始備份或前一個有效 release。

## 驗收界線

驗證 DNS 路由、來源與外部 TLS、憑證 SAN/效期、HTTP/WWW 轉址、公開資產 hash/內部筆記掃描、Origin 拒絕、聊天室與來源摘錄、Guided Action 跨頁高亮、住院 35→70→90→100、手動不計分、Preflight/Handoff、Demo 備援及375/390/430版面座標。虛擬鍵盤僅縮短 viewport 模擬；實體 iOS Safari 由 Developer A 驗收。

目前沒有 SSE endpoint；代理仍關閉 response buffering，維持 HTTP/1.1、無 Connection close，未移除應用自身 timeout。`AI_MODE=demo`、`ALLOW_PAID_AI=false`、無 Gemini Key，禁止自動切 Live。
