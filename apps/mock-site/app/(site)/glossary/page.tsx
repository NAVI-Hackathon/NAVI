import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/site/PageHeader";

export const metadata: Metadata = { title: "名詞解釋" };

// Same validated local records as the browser/backend knowledge index; no runtime crawling.
import { cardif } from "../../../../../shared/cardif.js";
const TERMS = cardif.glossary;

export default function GlossaryPage() {
  return (
    <>
      <PageHeader title="秒懂保險專有名詞" crumbs={[{ label: "名詞解釋" }]} />
      <PageBody>
        <p className="mb-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          本頁摘錄官網名詞說明，僅供理解一般用語；不代表個別保單條款、保障適用或理賠資格。
        </p>
        {TERMS.length === 0 && <p>目前尚無可驗證的說明。</p>}
        <dl className="divide-y divide-neutral-200 border-t-2 border-brand">
          {TERMS.map((item) => (
            <div key={item.id} id={item.id} data-tour-id={`glossary-term-${item.id}`} className="py-4">
              <dt className="text-lg font-bold text-brand-deep">{item.term}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed">
                {item.definition}
                <p className="mt-2 text-sm text-neutral-600">{item.category} · 資料來源：
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">{item.sourceTitle}</a>
                  {" · 擷取日期 "}{item.retrievedAt}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </PageBody>
    </>
  );
}
