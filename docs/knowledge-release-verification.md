# Knowledge Release 核對方法與結果

本文件記錄既有正式版本的技術核對，不構成新的資料核准，也不是簡報素材。原始審核金鑰、身分、Cookie 及測試原始報告不提交公開 Git。

## 核對範圍

- 核對日期：2026-10-27；正式 Release：`13d7fcb706818ffae99ac195d63e73521675c8c4`。
- Knowledge Version：`kb-1404d058190e380c66eedee1`。
- Public Snapshot SHA-256：`b990f20030b7f7243e8b0ff92ae4924de4a798ea2197e515965c5e5594a77013`。
- 共 107 個公開來源；前一版本 97 個條目的內容、ID、來源日期與導航保持不變。
- 新增 `faq:13`～`faq:22`，共 10 則；23 項審核是 22 個新增段落（含標題及跨問答段落）加 1 項整頁審核，並非 23 則 FAQ。

## 審核權威與歷史紀錄

`data/crawl/candidate-2026-10-21/review-checklist.json` 保留擷取當時的 23 項 pending。它是不可回寫的歷史候選紀錄，不能單獨用來判定目前發布狀態。既有私有審核庫的 HMAC journal、逐筆 candidateHash、整頁明確確認及 append_faq mapping 已核對；目前 23 項均為真實（非 synthetic）APPROVED，並與正式 manifest 的 approvedChangeIds 完全一致。

審核時間為 2026-10-26T15:55:27.221Z～2026-10-26T15:55:27.394Z。本機簽章只能證明紀錄未被竄改，不代表法巴官方背書。實際執行未新增決策或修改 Seed；測試用的獨立暫存審核庫不影響正式審核。

## 23 項到 10 則 FAQ 的映射

以下依原文的字元區間重疊建立映射。跨 FAQ 段落列出兩個 ID；純頁面標題不冒充一則 FAQ。每項均核對段落 SHA、候選 SHA 與整頁 SHA，完整值在本機 audit JSON。

| Candidate ID | 類型 | 對應 Source ID | 段落 SHA-256 |
| --- | --- | --- | --- |
| `change:b076c7e1b3c223b3ee4afdaa` | 標題／上下文 | 無（標題） | `945d299da78c8661f249f4f0395d1434b70c71bca4ce6a77ffb8524d71d648d0` |
| `change:fbc36ee398020350b6cbb115` | 原文段落 | faq:13 | `fd790b501760d11e33ee6d05a4e67355a0c9202dfda6a136e8ac6f1d0e616bcd` |
| `change:b6a026b4179cfcda7375aaeb` | 原文段落 | faq:13 | `ae8f8093d70960040ae420b9abb616fc4729b166dbdc489f2a352e294720df6a` |
| `change:3fcce63f42cb23b0983c8a98` | 原文段落 | faq:13、faq:14 | `a3ffce35778778c5abe0673139fcb753c17fad0f33c706f348d2796419f8f698` |
| `change:48c9db74009221a99f9cbef2` | 原文段落 | faq:14 | `67ba303f7df89af8409a8228e3e115f3dda199dae89392c7539b7400919474da` |
| `change:d65b79d405857e97c93b91d4` | 原文段落 | faq:14、faq:15 | `1f7e90cd2d4fbf04324319e22dfd7a37e8ee2f34883a1123a3ec2f8864d0a474` |
| `change:b082c7b9a37d406d30ce05ef` | 原文段落 | faq:15 | `33fd9fd0d89a202c5750eeeca9549f002410a26b64131cde503ad8630297fd2d` |
| `change:6e55e76da94f4a21e0586b21` | 原文段落 | faq:15 | `dfb2656f7be234cb6190419d1eb02dd12ec73fff13287d24c37cc2e2ae27864f` |
| `change:69feedc1e94c1bf4a3cbe9bc` | 原文段落 | faq:15 | `dceffcfb6782917b906235a609558767b48c9f3624f1c03f3d6c0fd04de79a10` |
| `change:0b52805506f1d2638853ee25` | 原文段落 | faq:15 | `38bd4456cfb32f22d87634960fd975dcf1d061ea40a2ac2e1234611c5f72037c` |
| `change:aa9d08985904d72cb3dc4d95` | 原文段落 | faq:15 | `3c97d51e20a4120549abe27f2f883f656bd67d27dc5a27d458b53fbe383c8d9b` |
| `change:5e7f717f724f1938f988683a` | 原文段落 | faq:15 | `75408399ff088574124133498b8e7ca385e3be46cdbad7a6a9a677850d2a9514` |
| `change:10fd493b3591d0f029efb287` | 原文段落 | faq:15、faq:16 | `36e98b1f096095b1bdaa1125b81e8771975e38923959c403505a72f2db9e6391` |
| `change:64bf18d148cefb061a6e92da` | 原文段落 | faq:16、faq:17 | `ec3e9694b697b9cdda1a4354cf5c4bc861d918d7fc34a2e2877a828b8eb678a9` |
| `change:2b044b08546b95274c9545df` | 原文段落 | faq:17 | `e353e76ea2a1015feba66d0b4bab3d6b0265d3d9193454b4249f02ae6f0a99a3` |
| `change:582338a92badb4fcd5dd7b40` | 原文段落 | faq:17 | `724007c7a183a810dff714d78bae152a9524dd6c76f27d892e98101fcc23d18a` |
| `change:ab8e8b7c2509db940e6dc52b` | 原文段落 | faq:17、faq:18 | `b60a49ead04ca5f5537f598a0a855cd08062f7d17af8fcc1b88f5cff318e90ae` |
| `change:5956a981a0a950928328d9cd` | 原文段落 | faq:18、faq:19 | `5f22a7d14ab01fcc7db84e787cbceae27d8eb9ab7b62dac36f606bba395900db` |
| `change:7e4fd11c29e9952d18abd1e2` | 原文段落 | faq:19、faq:20 | `6aba97caf02b8217124f1e3053876af062011e38ba8bda6b944b77a863bb0bf7` |
| `change:a3ec7e95cfc819b53e6306e0` | 原文段落 | faq:20、faq:21 | `3325a75c6eb58685dfaf1b48c0c7053d5d9c51db47c1b65908daf319508db500` |
| `change:22c29f034a7e1606589c7781` | 原文段落 | faq:21、faq:22 | `f80180a1b6b3dd6b5c0dca4c5e8b5c9d110f53b01187ecf6d2350502d488bea8` |
| `change:757464a908ef698a77acfe00` | 原文段落 | faq:22 | `317e2bafd5a38d36c233be19744641308c89f5807442f38f5c58455beb601575` |
| `change:2375f6378ddddc54a67efcde` | 整頁審核 | faq:13、faq:14、faq:15、faq:16、faq:17、faq:18、faq:19、faq:20、faq:21、faq:22 | 整頁 SHA 見下 |

整頁 normalized SHA-256：`80a42357900e9b2b512ba02448f97be469ce7edf5b4f05a5a2bd3241f8f40a1b`。

## Source、日期與導航

共同來源：<https://life.cardif.com.tw/zh/a319>（既有公開網站快照；本次不重新爬取官網）。

| Source ID | 問題 | retrievedAt | Navigation Destination |
| --- | --- | --- | --- |
| `faq:13` | 參加理賠聯盟鏈的公司有哪些? | 2026-10-21 | `/faq#faq-13` |
| `faq:14` | 參加保險醫起通的公司有哪些? | 2026-10-21 | `/faq#faq-14` |
| `faq:15` | 參加保險理賠醫起通的醫療院所有哪些? | 2026-10-21 | `/faq#faq-15` |
| `faq:16` | 適用的保單有哪些? | 2026-10-21 | `/faq#faq-16` |
| `faq:17` | 適用範圍有哪些？ | 2026-10-21 | `/faq#faq-17` |
| `faq:18` | 辦理方式有哪些呢？ | 2026-10-21 | `/faq#faq-18` |
| `faq:19` | 如何進行數位身分驗證？ | 2026-10-21 | `/faq#faq-19` |
| `faq:20` | 後續其他保險公司還會請我補資料嗎？ | 2026-10-21 | `/faq#faq-20` |
| `faq:21` | 要如何知道我申請案件轉送各保險公司的處理進度？ | 2026-10-21 | `/faq#faq-21` |
| `faq:22` | 請問有規定首家保險公司多久之內要轉送給其他公司嗎？ | 2026-10-21 | `/faq#faq-22` |

- 來源實際擷取時間：`2026-10-21T11:00:49.505294+00:00`；逐條 retrievedAt 沿用既有日期契約 `2026-10-21`。
- dataset.meta.crawled：`2026-10-26`，代表資料集整理時間，不覆蓋逐條來源日期。
- Knowledge releasedAt：`2026-10-26T15:57:01.034Z`。
- source.publishedAt：無可驗證資料，保持缺值／null；上述日期均不宣稱官方發布日期。

## 正式系統驗證

2026-10-27T11:48:24.460Z 由外部 HTTPS 唯讀驗證正式版本：Knowledge Version／Snapshot SHA／23 approvedChangeIds 與本機相同。10 則 FAQ 均能由正式 Knowledge Search 搜尋、由 Evidence API 引用，Source URL、日期及原文摘錄一致；模擬官網 `/faq` 的 `faq-13`～`faq-22` 目標均存在。未呼叫任何 Gemini 生成。

這是版本與來源一致性驗證，不代表本次重新確認官網的即時內容，更不代表申請資格或核賠結果。

## 重跑方式

```sh
npm run knowledge:verify-release
```

指令唯讀使用既有私有審核庫；公開 clone 缺少私有庫時會明確失敗，不得為了產生通過報告自動建立批准紀錄。可攜式 CI 使用隔離的合成審核庫，檢查 pending、synthetic、整頁未確認、竄改原文／日期／journal 均被拒絕。原始執行報告寫入 Git 忽略的 `artifacts/knowledge-release-audit/`。

對 A 的正確用語：**「23 項候選經人工核准，依官方快照整理為 10 則 FAQ（faq:13–22），Knowledge Version kb-1404d058190e380c66eedee1；來源擷取於 2026-10-21。」** 不寫成 23 則 FAQ，也不將 2026-10-26 當作官網發布日期。
