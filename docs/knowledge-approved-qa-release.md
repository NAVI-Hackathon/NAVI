# 已核准醫起通／理賠聯盟鏈Q&A發布紀錄

## 授權與範圍

使用者Sh明確確認23項全部核准採用，並確認faq:13～faq:22與/faq動態錨點。22個新增段落與1項整頁審查，依原文結構整理為10筆FAQ。此紀錄只涉及公開知識，不改Workflow、合作院所判斷、資格規則、Readiness、文件安全或AI計費。

## 版本與日期

- 知識版本：`kb-1404d058190e380c66eedee1`，前版`kb-ba0d6f040c788ecc9b406687`。
- Snapshot SHA-256：`b990f20030b7f7243e8b0ff92ae4924de4a798ea2197e515965c5e5594a77013`。
- 首次知識發布時間：`2026-10-26T15:57:01.034Z`；資料集整理日期`2026-10-26`。
- 新FAQ來源擷取時間：2026-10-21T11:00:49.505294+00:00，逐條retrievedAt為2026-10-21。
- 2026-10-26再次擷取的同頁正規化內容SHA與核准快照相同；未把後續複驗或部署時間套用成逐條日期。
- meta.legacyRetrievedAt=2026-10-06；原97筆來源URL、日期、ID皆保留，來源總數107。
- 沒有官方publishedAt資訊，因此未新增或宣稱官方發布日期。

## A可直接使用的資料契約

全部為faq類別，Source URL：https://life.cardif.com.tw/zh/a319。既有FAQ頁自動產生data-tour-id，不需新增UI或錨點元件。

| Source ID | 問題 | Navigation Destination | retrievedAt |
|---|---|---|---|
| faq:13 | 參加理賠聯盟鏈的公司有哪些? | /faq，anchor=faq-13 | 2026-10-21 |
| faq:14 | 參加保險醫起通的公司有哪些? | /faq，anchor=faq-14 | 2026-10-21 |
| faq:15 | 參加保險理賠醫起通的醫療院所有哪些? | /faq，anchor=faq-15 | 2026-10-21 |
| faq:16 | 適用的保單有哪些? | /faq，anchor=faq-16 | 2026-10-21 |
| faq:17 | 適用範圍有哪些？ | /faq，anchor=faq-17 | 2026-10-21 |
| faq:18 | 辦理方式有哪些呢？ | /faq，anchor=faq-18 | 2026-10-21 |
| faq:19 | 如何進行數位身分驗證？ | /faq，anchor=faq-19 | 2026-10-21 |
| faq:20 | 後續其他保險公司還會請我補資料嗎？ | /faq，anchor=faq-20 | 2026-10-21 |
| faq:21 | 要如何知道我申請案件轉送各保險公司的處理進度？ | /faq，anchor=faq-21 | 2026-10-21 |
| faq:22 | 請問有規定首家保險公司多久之內要轉送給其他公司嗎？ | /faq，anchor=faq-22 | 2026-10-21 |

## 已核准候選

| Candidate ID | 類別 |
|---|---|
| change:b076c7e1b3c223b3ee4afdaa | Added |
| change:fbc36ee398020350b6cbb115 | Added |
| change:b6a026b4179cfcda7375aaeb | Added |
| change:3fcce63f42cb23b0983c8a98 | Added |
| change:48c9db74009221a99f9cbef2 | Added |
| change:d65b79d405857e97c93b91d4 | Added |
| change:b082c7b9a37d406d30ce05ef | Added |
| change:6e55e76da94f4a21e0586b21 | Added |
| change:69feedc1e94c1bf4a3cbe9bc | Added |
| change:0b52805506f1d2638853ee25 | Added |
| change:aa9d08985904d72cb3dc4d95 | Added |
| change:5e7f717f724f1938f988683a | Added |
| change:10fd493b3591d0f029efb287 | Added |
| change:64bf18d148cefb061a6e92da | Added |
| change:2b044b08546b95274c9545df | Added |
| change:582338a92badb4fcd5dd7b40 | Added |
| change:ab8e8b7c2509db940e6dc52b | Added |
| change:5956a981a0a950928328d9cd | Added |
| change:7e4fd11c29e9952d18abd1e2 | Added |
| change:a3ec7e95cfc819b53e6306e0 | Added |
| change:22c29f034a7e1606589c7781 | Added |
| change:757464a908ef698a77acfe00 | Added |
| change:2375f6378ddddc54a67efcde | Requires Manual Review |

## 發布驗證

- 原文問答與段落SHA、整頁上下文、新錨點及逐項核准均經受控CLI驗證。審核憑證、操作者與完整簽章歷程只保留本機，不進公開Bundle。
- 最新版本Knowledge Evaluation為134題，無跳過案例；舊版回滾測112題適用案例，22題新增來源檢查明列為版本不適用，原有111題皆保留。
- 已實際在本機完成新版本→舊版本→重新套用已核准版本；審核歷程保留。雙站與API仍須隨正常應用Release部署才切換。
- 新來源只作知識回答及導航；沒有更新既有合作院所自動匹配或任何給付判定。
- 尚無即時官網查核、官方理賠核准或真正送件。Gemini請求0、付費呼叫0。
