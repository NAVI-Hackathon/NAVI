# Release 1 / Knowledge Refresh / Release 2 — 2026-10-21

## Release 1 安全範圍

同步基準 `f5692beaddac747df131b716805cc29c019bdb56`，已確認包含 4b838f1、97d0874、595c46e、ea7d0f5、f5692be。A 的 Claim Preflight、Explain Journey、Handoff Preview／Confirm、Stale Preview、Guided Action、iframe highlight、手機返回操作及 Manual Information 保留，不重做 UI。

Baseline：Frontend 41/41、Backend 151/151。原始 main checkout 的 `docs/phase-2a-report.md` 保留；開發使用獨立 worktree 的 `fix/public-knowledge-release`。

### 洩漏原因與修正

三個正式資料入口原先直接 import 完整 `data/cardif_seed_data.json`：

- `shared/cardif.js` → Shared Knowledge、Hospitalization、Navigation → NAVI Browser Bundle。
- `apps/web/src/content/cardifData.js` → 文件旅程／顯示資料 → NAVI Browser Bundle。
- `apps/mock-site/app/(site)/_lib/seed.ts` → 模擬站頁面及 client imports。

Zod.parse 在執行時略過未知欄位，無法保證原始 JSON 常數不進入建置產物。舊版 `2801167` 的真實 Production Web Bundle 掃描確認：8 個公開文字檔共 650,607 bytes，其中 `assets/index-vqc_kSGO.js`（實際檔名以掃描 JSON 為準）含被排除欄位與內部筆記指紋。不是僅移除畫面文字。

現在改成：

```text
data/cardif_seed_data.json（已移除開發備註）
  → shared/publicKnowledge.js（遞迴公開欄位白名單）
  → npm run knowledge:project
  → data/cardif_public_data.json（唯一 Browser JSON 入口）
  → 三個既有 Adapter（只改 import，不改 UI／介面）
```

原 Seed 的 meta.note／version、internal_notes、院所別名開發提示、轉送公司清單開發說明、known_inconsistencies 及 data_gaps 共 7 組非公開 metadata 移出。Nested Sitemap、服務／表單／FAQ 的順序和 ID、公開催辦資料、原文摘錄及既有日期維持；`meta.crawled` 未更新。

備份留在本工作樹 `data/private/`，目錄 0700、檔案 0600，已加入 gitignore。不得匯入程式、提交、部署或放進 public/。白名單投影為可重現生成檔，不是第二份手動維護的知識。

### 自動防線

- `npm run knowledge:check`：Seed 不可再含白名單外 metadata，公開投影必須與生成結果一致。
- 新測試注入頂層／meta／service／form／FAQ／sitemap 私有欄位，確認不進入公開投影。
- `npm run security:public`：掃描 Web dist、Next static、prerender HTML／RSC、JSON／Source Maps 等文字產物。
- Scanner 檢查被禁止欄位，以及舊內部筆記的不可逆 SHA-256 指紋，支援 Unicode／hex／URL／HTML／Base64 合理編碼。政策檔不保存筆記原文。
- `npm run build`、`build:navi`、`build:mock`、`build:all` 自動套用檢查；deploy builder 另掃描實際 Next Static Export，不接受只掃開發畫面的結果。
- 缺少預期目錄、零可掃檔案、過期 projection、metadata 或筆記命中都會失敗，不能發佈。
- 部署封包包含公開 projection；不打包 data/private、Mac node_modules 或醫療／銀行原始文件。

### 歷史暴露界線

已檢查 Seed 的兩個既有歷史版本：`7cc28fd`（2026-10-06）與 `4efe50f`（2026-10-21）。開發 metadata／舊地址註記曾在公開 Git 與 Browser Bundle 中可取得。檢視到的是開發備註、資料缺口與公開資訊整理，未辨識出真實客戶病歷、銀行帳號或金鑰；這不是整個 Repository 的完整 Secret Audit。

此修正不重寫 Git 歷史，也不能收回已被下載或快取的舊 Bundle。若之後識別出真正敏感資訊，需另行做來源刪除／憑證撤換及授權的歷史處理，不能只隱藏畫面。

## 日期與 A 的整合

Release 1 不採用新爬蟲資料，所有對外知識內容與日期保持原有經核對版本。

- `meta.crawled`：維持資料集原有整理日期，不等於本次部署日。
- `entry.retrievedAt`：沿用個別條目實際擷取日；既有 address／7 個 glossary 條目為 2026-10-20，其餘多為 2026-10-06。
- Source ID、sourceUrl、retrievedAt、navigationDestination 仍由 Shared Knowledge canonical record 提供，A 不需修改既有 API Adapter。
- Crawl Snapshot 的完整 ISO timestamp 只標示擷取時間，不是官方發布日；不得自動轉成所有條目的新日期。

## Knowledge Refresh 的採用閘門

先完成並驗收 Release 1，再於本機執行限定範圍、遵守 robots、至少 1.5 秒間隔的公開 HTML 擷取。保留原 Snapshot，PDF 只保留連結 metadata。失敗不得當成刪除。

後續會產生逐段 SHA-256 Diff 和 pending／approved／rejected／needs_followup 清單。**沒有逐筆人工批准，不採用新資料，也不部署 Release 2。** 涉及醫療文件、資格、合作院所等條件必須人工核對。本文件不把尚未執行的 Crawl 或 Release 2 標為完成。
