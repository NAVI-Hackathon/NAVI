import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader, SourceNote } from "@/components/site/PageHeader";
import { toSitePath } from "@/components/site/routes";
import { datasetDate, seed } from "../_lib/seed";

export const metadata: Metadata = { title: "保戶服務" };

const SERVICE_GROUP_URL = "https://life.cardif.com.tw/zh/a3";

export default function ServicesPage() {
  const group = seed.sitemap.find((g) => g.url === SERVICE_GROUP_URL);
  const items = group?.children ?? [];

  return (
    <>
      <PageHeader title="保戶服務" crumbs={[{ label: "保戶服務" }]} />
      <PageBody>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const href = toSitePath(item.url);
            const base = "flex h-full items-center justify-between rounded border px-4 py-4";
            return (
              <li key={item.url}>
                {href ? (
                  <Link
                    href={href}
                    data-tour-id={`services-item-${href.split("/").pop()}`}
                    className={`${base} border-neutral-200 font-medium hover:border-brand hover:text-brand`}
                  >
                    {item.name}
                    <span aria-hidden className="text-brand">›</span>
                  </Link>
                ) : (
                  <span className={`${base} border-neutral-100 text-neutral-400`} title="模擬網站未收錄此頁">
                    {item.name}
                    <span className="text-xs">（未收錄）</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <SourceNote sources={[{ url: SERVICE_GROUP_URL }]} datasetDate={datasetDate} />
      </PageBody>
    </>
  );
}
