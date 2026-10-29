# Judge audit Backend／A Renderer 契約

本文件描述候選修復，不代表正式站已部署。適用問題：NAVI-001、002、003、007、008、009；不改成功欄位、不改聊天室/UI/動畫。Sh 已同意由 B 完成 optional 契約、A 接 Renderer。

## 搜尋與 Evidence

既有 status 保持 `answered / not_found / out_of_scope`，Source ID、URL、日期、導航白名單不改。新增 optional `clarification`：

```json
{
  "reason": "date_context_missing",
  "blocking": true,
  "question": "你想申請哪一類理賠？不確定的是事故、住院／出院，還是文件上的日期？請先說明，不需要猜填日期。",
  "options": ["住院醫療理賠", "門診醫療理賠", "其他理賠", "不確定日期類型"]
}
```

- `blocking=true`：沒有選定服務／管道，或屬資格保證拒答；不產生導航計畫或新任務，Conversation 不呼叫 AI。status 為 not_found 或 out_of_scope。
- `blocking=false`：已知服務的來源仍可閱讀，但地址類型、受益人類型或付款細節尚需確認；不是資格通過。來源說明與實際辦理選擇分開。
- `reason` 完整 enum 見 `shared/knowledge/clarification.js`。澄清選項是需求分類，不是官方核准或已符合規定。
- 一般地址先分通訊／戶籍／收費。明確指定後不重問類型；是否可線上辦理由既有來源及會員／保單事實決定，不能由地址詞自行推定。
- 泛稱受益人變更先問身故／醫療失能／不確定，再依來源及專員確認事故、滿期、個人／團體條件；不要求 A 自己算資格。
- 付款與紅利先依主題配對，再排序；共同的「保單、給付、變更」不能替代主題。沒有足夠資訊或同時提到兩者時先澄清，不湊無關步驟。

原句重現：`我要變更保費付款方式。` → `service:change_payment_method` / `service-change-payment-method`；紅利給付仍是 `service:change_dividend_option`。這是本地檢索規則，不是 Gemini 語意準確率。

## POST /api/conversations/messages

Request 不變。Response 仍由 `ConversationReplySchema` 驗證，新增 optional `clarification` 與 `failure`。產生錯誤後會清除部分解析的 understanding，避免 grounding 失敗卻保存模型任務。

| 情況 | mode | understanding | errorCode / failure | 顯示方式 |
|---|---|---|---|---|
| AI 結構／grounding 成功 | live | TaskUnderstanding | null / 缺省 | 正常答案與任務；不保證資格 |
| AI 失敗，有可信來源 | retrieval | null | 真正的公開錯誤碼 / 有 | 清楚標示來源檢索備援，顯示 excerpts；不能叫 Live 成功 |
| AI 失敗，沒有來源 | retrieval | null | 真正錯誤碼 / 有 | 操作性錯誤、手動重試或客服；不要存取 tasks[0] |
| 無結果 | retrieval 或 live（若確有生成） | null 或真正任務 | 視有無 provider error | 明確資料不足，不補猜答案 |
| 無法選定服務／明確拒絕核賠保證 | retrieval | null | null / 缺省 | 顯示 clarification.question 與中性選項 |
| 需求修正需指定既有旅程 | retrieval | null | null / 缺省 | 使用既有 correctionRequired，不自動改其他任務 |

`failure={code,message,retryable}` 只含穩定公開碼及靜態繁中訊息；不轉送 Google 原始 payload、憑證或任意 exception.message。failure 出現時必須 mode=retrieval、understanding=null、errorCode=code。

- 可稍後手動重試：AI_PROVIDER_ERROR、AI_TIMEOUT、AI_BUSY、AI_UNAVAILABLE、AI_USAGE_UNAVAILABLE、AI_RATE_LIMITED、AI_SESSION_RATE_LIMITED、TEST_SESSION_CAPACITY、STORAGE_UNAVAILABLE。
- 原請求不可立即自動重試：AI_DAILY_LIMIT_REACHED、AI_SESSION_LIMIT_REACHED、AI_REQUEST_BUDGET_REACHED、AI_PROJECT_QUOTA_REACHED、AI_COST_LIMIT_REACHED、AI_RESPONSE_INVALID、AI_SAFETY_REJECTION、AI_MODEL_UNAVAILABLE、FREE_TIER_NOT_CONFIRMED、PAID_AI_DISABLED、LIVE_AI_DISABLED_IN_CI、AI_NOT_CONFIGURED、DATA_CONSENT_REQUIRED、TEST_SESSION_REQUIRED、TEST_SESSION_DENIED。需依狀況等待、補資料、完成同意或由操作員確認設定。
- HTTP 200 的 retrieval 回應代表「成功取得受標記的備援／澄清」，不是 AI 成功；硬性認證、儲存或請求驗證錯誤仍走既有非2xx error schema，不能一律視為可重試。
- `X-NAVI-AI-Mode=live` 表示伺服器 Provider boundary；同一回應的 mode=retrieval 明確表示此次沒有成功生成答案。不得從 Header 推導「這則是 Gemini 成功」。Conversation 沒有新造 isMock 欄位；有 understanding 時其 isMock 為實際來源，null 時不可讀取它。

## A 的 E13 接入與已知阻擋

`tests/fixtures/judge-conversation.js` 提供七種純合成 deterministic fixtures（含成功、retrieval-only、timeout、quota、無結果、澄清、核賠拒答）；不是 Google 結果。`tests/product/judge-contract.spec.js` 使用真實 A Renderer 與這些 HTTP 回覆。

目前 main 的 `App.jsx` 在 productReply.understanding=null 且 evidence.answered 時，建立 kind=answers 的本地 UI message 沒有 followUp；`components/landing/Landing.jsx` 讀取 `followUp.showAnswers` 而白屏。這和收到 Google 503 是兩個事件：前者是 Renderer 缺少本地狀態，後者是 Provider 失敗。

**A 待辦**：沿用既有 followUp builder 建立 answers message，或讓 Renderer 對沒有 followUp 的合法回應安全顯示。followUp 是 UI 狀態，不新增成 Backend 業務欄位、不要求伺服器假造 understanding。另呈現 optional clarification / failure，未知 optional 欄位可忽略，但 null understanding 必須安全處理。

E13 初次實測：6 個 fixtures，3 passed（無結果、澄清、拒答），3 failed（有來源 retrieval-only／timeout／quota）。保留 failures、screenshots 及 pageerror；不能因 Backend Schema 正確就宣稱 Browser E2E 通過。A 修復前不自動部署或強制合併。

## Journey 唯一來源

沿用 ServiceJourney，不建立新模型：extractedData 是使用者／已抽取事件資料；documents[].fields 是文件抽取；claimContext.hospital 是院所快照比對、claimContext.inpatient 是後端日期／天數；claimContext.channels[].eligibility 是資格待確認狀態；currentStage/readiness/consistencyIssues/nextAction 全由後端推導。

院所名稱已取得、入口可導航與 eligibility 是不同事。文件 verified 只指欄位一致性檢查；verification.authenticity / eligibility 均為 not_assessed。100% 不代表核賠、送件或正式客服收件。刪除／替換／重複上傳沿用後端規則；同一 bytes 的重複上傳應冪等，不強迫產生另一個文件ID。
