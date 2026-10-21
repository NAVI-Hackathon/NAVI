import type { Metadata } from "next";
import { PageBody, PageHeader, SourceNote } from "@/components/site/PageHeader";
import { displayOfficialUrl, SITE_ROUTES, toSitePath } from "@/components/site/routes";
import Link from "next/link";
import { datasetDate, seed } from "../_lib/seed";

export const metadata: Metadata = { title: "常見問題" };

/** data-tour-id for a FAQ entry: its 1-based position in data/cardif_seed_data.json (shared with NAVI). */
const faqTourId = (index: number) => `faq-${index + 1}`;

export default function FaqPage() {
  const groups = new Map<string, { q: string; a: string; index: number }[]>();
  seed.faq.forEach((item, index) => {
    const list = groups.get(item.source) ?? [];
    list.push({ ...item, index });
    groups.set(item.source, list);
  });

  return (
    <>
      <PageHeader title="常見問題" crumbs={[{ label: "保戶服務", href: SITE_ROUTES.services }, { label: "常見問題" }]} />
      <PageBody>
        <div className="space-y-10">
          {[...groups.entries()].map(([source, items]) => {
            const page = toSitePath(source);
            return (
              <section key={source} aria-label={displayOfficialUrl(source)}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-bold text-brand-deep">
                    {page ? <Link href={page} className="hover:underline">{pageName(page)}</Link> : "其他"}
                  </h2>
                  <span className="text-xs text-muted">來源：{displayOfficialUrl(source)}</span>
                </div>
                <div className="divide-y divide-neutral-200 border-t-2 border-brand">
                  {items.map(item => (
                    <details key={item.index} data-tour-id={faqTourId(item.index)} className="group" open>
                      <summary className="cursor-pointer list-none px-3 py-3 font-medium marker:hidden">
                        <span className="mr-2 text-brand">Q</span>{item.q}
                      </summary>
                      <p className="px-3 pb-4 pl-8 text-[15px] leading-relaxed text-muted">{item.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <SourceNote sources={seed.faq.map((f) => ({ url: f.source, retrievedAt: f.retrievedAt }))} datasetDate={datasetDate} />
      </PageBody>
    </>
  );
}

function pageName(path: string) {
  return ({
    [SITE_ROUTES.claims]: "理賠程序介紹",
    [SITE_ROUTES.policyLoan]: "保單借款",
    [SITE_ROUTES.online]: "網路保險服務",
  } as Record<string, string>)[path] ?? "保戶服務";
}
