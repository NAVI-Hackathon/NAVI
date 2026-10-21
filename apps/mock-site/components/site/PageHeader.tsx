import Link from "next/link";
import type { ReactNode } from "react";
import { displayOfficialUrl, SITE_ROUTES } from "./routes";
import type { SourceRef } from "@/app/(site)/_lib/seed";

export type Crumb = { label: string; href?: string };

/** 頁面標題列：麵包屑 + 綠色標題帶 */
export function PageHeader({ title, crumbs }: { title: string; crumbs: Crumb[] }) {
  return (
    <div className="bg-brand-light">
      <div className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        <nav aria-label="麵包屑" className="text-xs text-muted">
          <ol className="flex flex-wrap gap-1">
            <li><Link href={SITE_ROUTES.home} className="hover:text-brand">首頁</Link></li>
            {crumbs.map((crumb) => (
              <li key={crumb.label} className="before:mr-1 before:content-['›']">
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-brand">{crumb.label}</Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="mt-2 text-2xl font-bold text-brand-deep md:text-3xl">{title}</h1>
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">{children}</div>;
}

/**
 * 資料來源標示（純文字，不連到真實官網）。每個網址顯示該頁條目自己的擷取日期；
 * 條目沒有日期時改標「資料集整理日期」，兩者不混用。
 */
export function SourceNote({ sources, datasetDate }: { sources: SourceRef[]; datasetDate: string }) {
  const byUrl = new Map<string, { dates: Set<string>; undated: boolean }>();
  for (const source of sources) {
    const entry = byUrl.get(source.url) ?? { dates: new Set<string>(), undated: false };
    if (source.retrievedAt) entry.dates.add(source.retrievedAt);
    else entry.undated = true;
    byUrl.set(source.url, entry);
  }
  const label = ({ dates, undated }: { dates: Set<string>; undated: boolean }) => {
    if (!dates.size) return `（資料集整理日期 ${datasetDate}）`;
    const checked = `擷取日期 ${[...dates].sort().join("、")}`;
    return undated ? `（${checked}；其餘條目為資料集整理日期 ${datasetDate}）` : `（${checked}）`;
  };
  return (
    <p className="mt-8 border-t border-neutral-200 pt-3 text-xs leading-relaxed text-muted">
      資料來源：法國巴黎人壽官網{" "}
      {[...byUrl.entries()].map(([url, entry], index) => (
        <span key={url}>
          {index > 0 && "、"}
          {displayOfficialUrl(url)}
          {label(entry)}
        </span>
      ))}
    </p>
  );
}
