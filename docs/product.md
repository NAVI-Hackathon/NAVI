# NAVI · Product scope

NAVI — AI Service Journey Navigator。法國巴黎人壽智慧服務導航，將使用者描述轉為可執行的服務旅程。

AI interprets. The system decides.

產品嵌入模擬保險官網，提供自然語言知識查詢、可追溯來源，以及「帶我去」換頁／分頁、捲動與高亮。NAVI 與模擬官網維持獨立 routing 與執行程序。使用者介面以台灣繁體中文為主。

## 本次展示

- 主旅程：住院醫療理賠，35 → 70 → 90 → 100。
- 文件：診斷書或住院證明、存摺影本（匯款給付示範）。病理／手術文件依病況列為條件性，不一律必備。
- 服務導航：合作院所醫起通、理賠聯盟鏈與郵寄管道說明；實際使用條件依來源與專員確認。
- 知識：保單資料／地址變更、受益人變更表單、保單借款、網路服務／密碼鎖定及 FAQ。
- 來源：本地公開官網整理資料，附原始網址與整理日期，沒有官方網站 runtime fetch。

## 已完成與實際落差

Developer A 的 UI、Motion、桌面三欄、手機 Tabs、來源面板、sessionStorage 與示範重設沿用現況。本次 Developer B 沒有修改 `apps/web` 或 `apps/mock-site`。

Backend 支援 server-owned 住院 Journey、Demo 文件、Gemini Structured Extraction transport、欄位驗證／矛盾檢查、deterministic 準備度／下一步與可追溯知識摘錄。前端目前仍用本地 Mock 文件／workflow 與本地知識搜尋，尚未接入完整 Backend Journey／Knowledge API。A 接入後應直接渲染後端狀態，不再重算分數。

實際 Gemini 理解與辨識能力本次未驗證；只使用合成資料與注入 transport，零外部 AI 請求。準備度只代表原型的資料準備程度，不是保障、給付、核准、帳戶真偽或正式文件有效性的判定。

## 邊界

無投保建議、保障／理賠資格或金額判斷、完整送件、真人通知、Auth、MongoDB、Vector DB、Multi-Agent。住院天數依有效日期做含入出院日的原型計算，或使用文件明載天數並標示來源，不計算保單核付日數。部分資料／矛盾需要人工確認。

預算 $0：預設 Demo、本地知識與 InMemory；Free Tier Guard、禁止付費 flag、Live budget 保持原樣。Live 必須另經人工確認與啟動，不自動切換或增加額度。

班機延誤、車禍 enum 與相關合成 fixtures 僅保留向下相容／Legacy regression；不宣稱法國巴黎人壽提供這些服務。最新契約、PR #2 Review 與驗證見 [Backend 住院實作](backend-hospitalization.md)。
