import type { ReactNode } from "react";
import { NaviHost } from "@/components/navi/NaviHost";
import { toSitePath } from "@/components/site/routes";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader, type NavGroup } from "@/components/site/SiteHeader";
import { datasetDate, seed } from "./_lib/seed";

/** 這兩組不放進主選單：外部會員系統不爬、其他專區放在頁首小連結 */
const HIDDEN_GROUPS = new Set(["外部/會員系統（不爬）", "其他專區"]);

const navGroups: NavGroup[] = seed.sitemap
  .filter((group) => !HIDDEN_GROUPS.has(group.name))
  .map((group) => ({
    label: group.name,
    href: toSitePath(group.url),
    children: group.children.map((child) => ({
      label: child.name,
      href: toSitePath(child.url),
    })),
  }));

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader groups={navGroups} hotline={seed.contacts.hotline} />
      <main className="flex-1">{children}</main>
      <SiteFooter
        hotline={seed.contacts.hotline}
        address={seed.contacts.address}
        datasetDate={datasetDate}
      />
      <NaviHost />
    </>
  );
}
