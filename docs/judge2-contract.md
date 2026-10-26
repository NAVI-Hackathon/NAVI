# 第二位評審修復：A 接入契約

A 已同意本輪 Backend/shared 相容擴充；B 不改聊天室、版面、動畫或 Guided Action。基準 main `ed8ff586626cf1bd18744a4bd2f2c5606a80b729` 已含 A 的多任務／修正需求 UI，以及使用者任務測試計畫。

## 管道：入口與條件分開

`journey.claimContext.channels[]` 保留原欄位，新增 optional：

```json
{
  "available": true,
  "navigationAvailable": true,
  "eligibility": {
    "status": "requires_confirmation",
    "scope": "channel_conditions_only",
    "coverageAssessed": false,
    "reason": "此處提供管道說明與入口，申請條件仍需確認，不代表已符合資格。",
    "sourceIds": ["service:claim_union_chain"],
    "unconfirmedRequirements": ["限具完全行為能力之被保險人本人，以匯款給付本人帳戶", "需先註冊巴黎線上會員"]
  }
}
```

上例為節錄，不是實際 Gemini 回應。完整待確認事項由公開快照同一服務的 documents/notes 原文提供；NAVI 說明文字不是「官網原文」。

- `available` **deprecated**：維持舊值以免破壞舊 Adapter。醫起通為快照院所名稱是否比對；聯盟鏈／郵寄為資訊入口存在。不能用它顯示「符合申請資格」。
- `navigationAvailable`：該目的地通過可信 Registry 白名單；不是申請資格，也不是已經捲動成功。執行仍須通過 Backend Navigation Plan 的建置 manifest 檢查和前端實際目標定位。
- `eligibility.status`：型別保留 `eligible`／`requires_confirmation`／`ineligible`。**本輪 producer 全部只回 requires_confirmation**：未取得會員、保單與保險公司審核等足夠事實，不能確定資格；院所與文件欄位符合也不例外。
- 不在目前合作院所快照／不存在分院，不代表已取得官方「不合作」證明；保守待確認，不放寬比對，也不自動宣稱 ineligible。
- `eligible` 也只能指該管道條件，不代表保障適用或理賠結果；目前沒有實作會回 eligible 的分支。未來須另行審核來源、必要事實及確定性規則，不能由 AI 或瀏覽器指定。
- 缺 optional 欄位的舊回應，A 一律顯示「條件待確認」，不能把缺值當 eligible。
- 下一步仍只是「查看」來源／管道資訊。100% 不會把這個狀態改成 eligible。

需調整的 A 元件：`JourneyTimeline.jsx` 的 ChannelList（建議標籤改為「建議先查看」，資格另列待確認）；`JourneyDialogs.jsx` 的 ProceedDialog（「可查看的管道」，避免暗示已判定可申請）。Demo 的 `services/journeyEngine.js` 目前仍產生舊 channel 形狀，A 可復用 `hospitalClaimContext` 或依上述保守缺值方式顯示；B 本輪不改此區。

## 文件 verified 的界線

`DocumentSchema` 新增 optional `verification`：

```json
{"scope":"prototype_field_consistency","authenticity":"not_assessed","eligibility":"not_assessed"}
```

Backend 對 verified／needs_review 都明確附上；Gemini 原始輸出不得自行加這個欄位，必須由 Backend 填入。`status=verified` 只表示原型欄位、信心門檻及一致性檢查通過。不是醫院／銀行發證真偽、簽章、原本／正本或保單資格驗證。

建議 A 文案：「欄位檢查通過，尚未驗證文件真偽」。舊文件沒有 verification 時，同樣採保守解讀，不能回推已驗真。正式模式 `manualDocumentInformation` 維持 manual/needs_review、不計文件分數。Demo 的手動合成件仍是 Demo，不能當作正式驗證證據。

## 公開入口

- `https://navitw.com/demo`、`/demo/` 固定轉到 `https://navitw.com/?navi=demo`，丟棄原 query，避免可控 return URL。
- `https://app.navitw.com/demo` 仍是原 React Demo；`/demo/` 只去掉尾斜線並保留 query。
- `app.navitw.com/embed/` 同理轉到 `/embed`；`/embed?mode=demo` 不變。
- React 工作區仍用 `#workspace`；不新增任意未知 path 的 History Fallback，遺失資產不能回假 HTML 200。
- HTML／轉址不長期快取，內容雜湊 JS/CSS 保留長快取；iframe origin、CSP、Session、API Contract 不變。

## 日期、資料與量測

Knowledge 仍是 `kb-1404d058190e380c66eedee1`，沒有修改正式 Seed、發布候選或新增導航錨點。

量測以 `docs/usability/protocol.md` 為準：180 秒內、未受協助、正確目標才算 success；time_s 失敗填180、完成時間中位數只取成功者；wrong_clicks、help、SEQ、confidence 定義不另起一套。`scripts/usability/summarize.js` 已存在，直接沿用。平均操作步數目前未在 A 的記錄表收集，不能用 wrong_clicks 冒充。
