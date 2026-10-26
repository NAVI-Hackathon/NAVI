import { SYSTEM_PROMPT } from './intentPrompt.js';
export const TASK_PROMPT = SYSTEM_PROMPT.replace('多種需求或不清楚時用 unknown。', '每項需求分別分類；不清楚的項目用 unknown。') + `
本操作只拆解需求，不建立案件。輸出 tasks（最多四項），每項含 input 和 data。
input 必須是使用者原始輸入中連續且完整的原文片段，不能改寫或新增；data 遵守意圖資料 schema。
多種不同需求必須各保留一項，例如改地址與住院申請不得只保留其中一項。相同服務的獨立需求也不要合併遺漏。
若超過四項、無法可靠拆解、沒有明確需求，回傳一項涵蓋完整輸入的 unknown，請使用者分步說明。
「我搬家了，幫我處理一下」可辨識 policy_change，但不能假定已完成地址變更；須確認。
「我其實不是住院，是門診」不是住院申辦，不得沿用住院資料。這是範圍修正，不得創造門診給付資格。`;
