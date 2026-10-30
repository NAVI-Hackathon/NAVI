# OllamaProvider 與受控 Agent 契約提案

基準：`6bc1a90d49a50344d4fde89b873bcbf622faeb38`，2026-10-30。**尚未加入 Runtime 或 shared Schema**。此文件供 A／B 審閱；欄位新增、enum 擴充及前端讀取調整需獨立契約 PR，不能只因本文件存在就認定已支援。

雙模型更新：Facade 保留舊方法，內部分離 Text Provider 與 Vision Provider；主模型固定 Qwen3 4B，視覺模型先測既有 Qwen3.5 再比較 Qwen3-VL。選定規則／合成題組／資源計畫見 [本地雙模型](ollama-vision-evaluation-plan.md)。

## 1. 模式、Backend 與模型分離

最終目標設定：

```dotenv
AI_MODE=live
AI_BACKEND=ollama
OLLAMA_TEXT_MODEL=qwen3:4b-instruct-2507-q4_K_M
# Staging 先驗證既有模型；此值不是正式選型結論。
OLLAMA_VISION_MODEL=qwen3.5:4b
OLLAMA_BASE_URL=https://127.0.0.1:19134
ALLOW_PAID_AI=false
```

這是未來環境契約示意，**現有 env.js 並不支援**。CA、Client Certificate、私鑰路徑與完整模型 digest 另從 Backend 私有設定讀取，不進 Vite／Next 公開變數。TLS Server Identity 為 `navi-inference.internal`，即使連線走 Loopback 也驗證 CA／SAN；不設全域跳過 TLS 驗證。

- `AI_MODE` 維持 `live/demo/unavailable`；`AI_BACKEND` 最終 live 僅接受 `ollama`，缺漏／未知／`gemini` 值啟動時拒絕，不默默選 Google。切換前在 Staging 明確啟用，不提前破壞現有 Production 的設定。
- `OLLAMA_TEXT_MODEL`／`OLLAMA_VISION_MODEL` 各自只允許後台核准且已在本機的 tag／完整 digest，取代初版設計的一個 `OLLAMA_MODEL`；這些都還不是既有 Runtime 變數。候選比較在受控設定中指定 Qwen3-VL，不由訪客切換。URL／模型／Backend 不接受 request body、Header、Prompt 或工具參數覆寫；不自動 pull 模型。
- 公開 Demo 保留原有 Frontend Local Adapter；Demo 不呼叫 Gateway／Ollama／Google。後端不能根據使用者自行傳的 `mode=demo` 變更正式案件 Provider。
- Google Free Tier、Google Key、模型備援邏輯與本地資源政策分離。最終 Production 路徑不得載入 Gemini Provider；歷史 Google 評測可保留為離線資料，不在新 Router 中候選。
- 不因改成本地模型取消 Session、owner、檔案檢查、同意、Rate Limit、Queue 或 Audit；每日 20／Session 6 等舊 Google 限額不是本地產品的固有能力上限，但本輪不改正式配額。

## 2. Text／Vision 獨立介面，保留既有 Facade

計畫由現有 `createAIProvider()` 建立相容 Facade，組合 Text Provider、Vision Provider 與 Document Pipeline；不新增第二套 Intent／Journey／Knowledge Service。實作檔案可各置於 `apps/api/src/ai/`，不把所有邏輯塞在一個 Provider。

| 私有介面 | 責任／禁止事項 |
|---|---|
| Text `generateStructured(request, signal)` | 文字／Context／後端選 Schema；提供下表前五項方法，不能接收 raw images/PDF |
| Vision `observePage(page, signal)` | 實際頁面 image bytes → 頁面 Observation；無工具、無 owner／Journey 權限，不直接回 verified／readiness |
| Document Pipeline | 文字層／Render／圖片路由，跨頁整合／來源核對，再回舊抽取 Schema；表單不新增公開類型 |
| 兩者各自的 capabilities／health／metadata | 分別記實際模型與完整 digest；一個失敗不把另一個誤標成不可用或成功 |

共用單一 GPU Admission／Queue 與總 Deadline，不是每個 Provider 都開一個 GPU 槽。此分離只在 Backend 內部，不要求 A 重做 UI。

| 方法（保留既有呼叫形狀） | 回傳與控制界線 |
|---|---|
| `understandIntent(message, signal)` | 既有 Intent 領域 Schema；共用安全 normalization，Disposition 仍由 Backend 決定 |
| `understandTasks(message, signal)` | `ProviderTasksSchema`；多任務片段、否定、修正由現有 Task Service 再驗證，不自動建案 |
| `converse(message, context, sources, signal)` | `ConversationGenerationSchema`；只用授權且有界的歷史／Source，不回 currentStage、readiness 或任意 URL |
| `answerKnowledge(question, context, signal)` | `GroundedAnswerSchema`；Source ID 僅限本次已驗證結果，原文再經 Evidence 檢查 |
| `summarizeHandoff(knownFacts, signal)` | `HandoffSelectionSchema`；只能選已知事實，保留 deterministic template；不宣稱送達客服 |
| `analyzeDocument(upload, signal)` | 既有 Document 抽取 Schema；文字 PDF → Text、掃描頁／圖片 → Vision，再由 Pipeline 驗證。**不是把原始圖像送給文字模型** |

以現有 Zod 產生 Ollama `format` JSON Schema，`stream: false`、明確輸出上限，依 [Chat API](https://docs.ollama.com/api/chat)讀取 `message.content`，JSON.parse 後再 Zod／normalization／業務驗證。不用 Regex 從任意回答抓 JSON，不把 Schema 合法當成事實正確。[Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)僅提供格式約束。

原本 `normalizeGeminiIntent/Document` 可在原檔提取 Provider-neutral 函式，保留舊名稱作相容匯出，避免整套重寫。Prompt 分離 System／User／文件不可信內容；現有禁止核賠、來源限制與缺失為 null 的要求保留。

### 文件證據內部介面

`analyzeDocument()` 的舊輸出保持不變，不能把新欄位直接塞進 strict Schema。文件 PR 另定義私有 `analyzeDocumentWithEvidence(upload, signal)` 回傳 `{ extraction, evidence }`：

- `extraction` 仍是既有領域 Schema。
- `evidence` 記錄 Worker 實際產生的頁面／Render hash、欄位位置、核對方法／品質／Pipeline 版本。Vision 的 quote／bbox 仍是不可信提案，不因來自內網就變成已驗證證據。
- Document Service 用此證據及既有 validation／consistency 決定狀態；只有表格／標籤／頁碼可正確對上的欄位才能通過。unsupported／不完整結果走 needs_review。
- 若公開 Document 要附 optional `extractionMetadata`，另請 A review；不回傳 OCR 原文、姓名片段或完整銀行帳號。不在此輪建立新 Schema。

## 3. 請求生命週期、Queue 與 Metadata

1. Session 驗證及輸入大小檢查先做；同一 requestId 沿用既有 Idempotency。所有 Job／工具都綁後端 owner／Session，模型不能指定 owner。
2. 使用現有 `resourceQueue` 作 NAVI 有界背壓；只有真正模型 HTTP 執行期間占推論槽，工具和外層 Agent 不能再套同一 Queue 形成死鎖。OCR 另用 CPU Job Queue。
3. `withProviderDeadline` 含排隊、上游連線、讀取與 Schema 處理；呼叫方取消會傳到 Gateway、Worker、Ollama。整個 Agent Turn 再有總 Deadline，不能每輪重設整體時間。
4. 初版每次生成固定 **一次嘗試、零自動重試、零故障備援切換**。依文字／影像任務分流到已選模型是明確 routing，不是失敗切換；每頁／每輪各記一次，不隱藏新增生成。Queue 拒絕或呼叫前取消不算生成；送出後狀態不明算已嘗試，不能為拿到回應而重送。Circuit Breaker 分 Text／Vision 操作判斷，且不重啟共享 Ollama。
5. 現有 `productSession.bindProvider()` 用 `getModelRouter()` 是否存在來決定扣 Session 額度；改為單一、明確的 Backend 生成執行器負責每次實際 dispatch 的計數，否則六個方法／Agent 多輪可能漏計或重計。不得以實作空的 `getModelRouter` 繞過計數。
6. 使用量依 Backend／模型／Session 記錄，保留 Mongo 原子操作與重啟不歸零。過去 Google 計數不改寫；本地工作預算由實測資源政策設定，前端不能改。

Server-owned metadata 每個 requestId 獨立，不再用 `Map<operation, lastResult>` 混到並發請求：

| 欄位 | 意義 |
|---|---|
| backend／role／model／modelDigest／runtimeVersion | 實際處理身分與 text／vision 階段；文件若走多階段，逐次保留，不以主文字模型名冒充視覺模型。完整 digest 從實際安裝模型取得 |
| operation／requestId／attempts／schemaValid | 操作、嘗試及格式驗證；不記敏感輸入 |
| queueMs／loadMs／inferenceMs／totalMs | 個別階段及完整 API 延遲，明列量測點 |
| promptTokens／outputTokens | 對應 Ollama `prompt_eval_count/eval_count`；取不到為 null，不能推測 Google Token Usage |
| isMock／fallbackUsed／errorCode | 真實 Ollama 為 false／false；retrieval fallback 不計模型成功 |

Ollama duration 以奈秒回傳，需換算。HTTP 中止後是否真正停止 GPU 必須實測；未證實前不能把取消等同已釋放共享資源。

## 4. 公開 API 相容性與 A 的 Migration Notes

| 現有介面 | 提議變更／讀取順序 |
|---|---|
| `X-NAVI-AI-Mode` | 繼續 live／demo／unavailable，反映伺服器實際處理模式；不接受瀏覽器宣稱 |
| 實際 Backend 識別 | 可新增 server-owned optional `X-NAVI-AI-Backend: ollama`，若採用須加入 CORS Expose Headers 並驗證 Nginx 保留；mode 不等於 Backend 身分 |
| `Understanding.meta.source` | 加 `ollama`；舊 strict enum 客戶端會拒絕，**必須 A 先更新讀取者**，不能只稱 optional 無痛擴充 |
| `services/apiJourney.js` 內本地 ref | 支援新來源並保留 v3 舊 Gemini ref／授權歷史；版本遷移不能清掉使用者 Journey |
| Document `isMock` | 真實 Pipeline false；Demo true。偵測到合成 SHA 也不能改成「AI 已成功辨識」 |
| Conversation 回應 | 保留 `mode: live/retrieval`、`understanding: null`／errorCode／來源欄位；先修 A nullable Renderer，無新結果也可用可信檢索 |
| `/api/ai/status` | optional backend／checkedAt／capabilities，Text／Vision 各有 health／model；舊主 available 不得掩蓋文件能力失效。不能只檢查 mode===live，也不把 metadata Ping 當推論品質證明；詳細公開形狀與 A 另對齊 |
| `/api/health`、`/api/ready` | 健康不再以 apiKey 存在代表 AI 可用；ready 仍確實檢查 Mongo。家中模型斷線不應導致整個 API 不斷重啟或 Knowledge／歷史無法使用 |
| 同意／Session | 新本地處理 consent 版本，說明 VPS、家中 Pipeline、Atlas、保存與刪除。不能自動把舊 `gemini-unpaid-2026-10` 同意轉為新同意 |
| Task／Receipt／歷史回應 | 保留帳號／owner／已存 Task／Journey。短期 Receipt 與回應快取新增 Backend provenance；舊 Gemini 回應不可重新標為 Ollama，也不能用舊模型結果當本次推論成功 |

**錯誤沿用 `{error:{code,message,retryable}}`**，不回原始上游錯誤、主機路徑或文件文字：

| 情況 | 舊契約優先使用 | 建議繁中處理 |
|---|---|---|
| 排隊滿／共享 GPU 無空位 | `AI_BUSY`，429 | AI 目前忙碌，請稍後再試；仍可查詢可信來源 |
| Tunnel／Gateway／固定模型不可用 | `AI_UNAVAILABLE`，503 | AI 分析暫時無法使用；未分析文件，不套用示範資料 |
| 生成／OCR超時 | `AI_TIMEOUT`，504 | 分析逾時，尚未完成欄位檢查；保留未驗證手動資料 |
| 模型 JSON／Schema 不符 | `AI_RESPONSE_INVALID`，502 | 分析結果不完整，需要補充或人工確認；不給分 |
| 資源帳本不可用 | `AI_USAGE_UNAVAILABLE`，503 | 暫停生成，不繞過資源／濫用保護 |
| 使用政策上限 | `AI_DAILY_LIMIT_REACHED` 等既有碼 | 僅在實際仍配置該政策時回，不假稱本地模型有 Google 免費配額 |
| Request／Session／Journey 失效 | 沿用既有碼 | 不把取消／跨帳號／Stale 當成 AI 成功，不覆蓋較新資料 |

較細的 OCR／Tunnel 原因可留在脫敏內部診斷；公開細碼新增前由 A 確認，不要求重做聊天室、動畫或 Guided Action。

## 5. 最小唯讀 Agent Orchestrator

放在現有 Conversation Service 下，使用普通函式 registry；不加 LangChain、Multi-Agent 或第二套 Workflow。模型提出工具／參數，Express 逐項 Zod、owner、版本、白名單檢查後執行。

| 工具 | 僅允許的參數 | 後端執行／輸出 |
|---|---|---|
| `get_current_journey` | journeyId（UUID） | 只取當前授權 owner 的既有 Journey，遮蔽欄位、revision、服務及狀態 |
| `search_insurance_knowledge` | query（1–500 字）、limit（1–3） | 既有本地檢索／Evidence；僅發布版，回 Source ID／原文／版本 |
| `get_required_documents` | journeyId | 既有 Requirement，條件性／missing／needs_review 不混淆 |
| `get_next_best_action` | journeyId | 既有 deterministic Next Action，不由模型重算 readiness |
| `get_navigation_plan` | sourceId | Source 須來自本次可信結果、對應現有 manifest／錨點；只回計畫，**不執行導航** |
| `request_clarification` | 後端核准的 reason enum | 由後端選問題／可選服務，不讓模型自由要求身分證或帳戶秘密 |

所有參數 Schema strict／`additionalProperties:false`。禁止任意 URL、檔案路徑、Shell、SQL、ownerId、模型名或 HTTP 工具。LLM 提出別人的 Journey ID 仍必須被拒絕；即使工具是唯讀，也不能洩漏私有欄位。

[Ollama Tool Calling](https://docs.ollama.com/capabilities/tool-calling)描述 native `tools/tool_calls`，但指定 tag／實際 runtime 的支援尚未驗證。實作先以固定 Schema 的「工具提案」回應 qualification；若 native tools 通過同一套測試可直接採用，不能聲稱兩者已測。也不能假設 `format` 與 native tool calling 在這個版本可任意混用。

內部提案 envelope 為 strict discriminated union：`kind=tool_calls` 時只接受 registry 名稱及對應 arguments；`kind=final` 時接受既有生成回應 Schema。每個 tool call 的關聯 ID 由 Backend 建立，工具結果以 tool role／明確資料區塊回傳模型，不能被當成 System instruction。此 envelope 不直接加入既有 `ConversationReplySchema`，由 Orchestrator 驗證後才回舊 API 格式。

第一版提案限制：每個 Turn 最多 **3 次模型決策、6 次工具、順序執行**；工具相同參數重複且無進度即停止。個別工作及總輸入／輸出皆有上限；Context 超出就明確澄清／摘要已確認資料，不能靜默丟掉否定或獨立任務。

總 Deadline 候選為 80 秒（含 Queue／工具／生成，前端需留至少 90 秒）；單筆 OCR 與模型也受剩餘時間約束，不能每輪續命。現有外層 Timeout 需與 A 一起設定，**以上尚未實測或改動**。初版單次 provider 方法一次生成；Agent 的最多三次是顯式工作預算，不是假借 Retry 追加。

流程：授權上下文 → 已發布 Knowledge → 模型提案 → 工具驗證／唯讀執行 → 記錄有界工具結果 → 必要時下一輪 → 最終答案／來源再驗證。無來源／惡意參數／工具超額／過期版本就停止，以已驗證檢索或澄清回應，不存假成功任務。

新增／修正 Journey、文件套用、Handoff Confirm、導航執行仍走現有明確使用者操作、後端 CAS／Idempotency／同意檢查；不放進初版模型工具。Audit 只記工具名、授權／驗證結果、耗時、必要版本與關聯 ID，不記敏感工具結果全文。

## 6. 契約驗收清單

- 舊 Gemini 歷史和新 Ollama 來源可同時讀取，無 enum crash、資料遺失或錯誤重新標記。
- 所有六個 Facade 方法及 Text／Vision 私有介面使用 Mock Ollama HTTP 驗 Schema、images bytes、abort、截斷、空回應、503、Queue 滿、模型不存在／digest 改變與 Timeout；0 外部 AI。
- 文件錯誤／低品質／Injection／錯誤標籤／日期矛盾不給分，不因 Schema 合法即 verified。
- 工具錯名、額外參數、跨 owner、Stale、假 Source／Anchor、迴圈及 Budget 超額均拒絕；工具無寫入／自動導航副作用。
- 真實推論與 retrieval-only 的標記、isMock、來源、錯誤及健康資訊一致；Demo 完整零模型呼叫。
- 使用測試 Transport 的禁止清單驗證：Ollama 斷線、服務啟動、各方法和 Agent 循環均不連 `generativelanguage.googleapis.com`／Vertex／付費或其他外部生成服務；傳送計數與 Mongo 使用量一致。
- 實際 Qwen Structured Output／工具能力、兩個視覺候選的讀圖／欄位品質、OCR 佐證及 GPU 取消尚待 Staging，不能用上述 Mock 通過取代。先既有 Qwen3.5，再 Qwen3-VL，測試詳見 [雙模型計畫](ollama-vision-evaluation-plan.md)。
