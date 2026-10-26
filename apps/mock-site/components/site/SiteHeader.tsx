"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SITE_ROUTES } from "./routes";

export type NavLink = { label: string; href: string | null };
export type NavGroup = NavLink & { children: NavLink[] };

function NavItem({ link, className }: { link: NavLink; className: string }) {
  if (link.href) {
    return (
      <Link href={link.href} className={`${className} hover:text-brand`}>
        {link.label}
      </Link>
    );
  }
  return (
    <span className={`${className} cursor-not-allowed text-neutral-400`} title="模擬網站未收錄此頁">
      {link.label}
    </span>
  );
}

export function SiteHeader({ groups, hotline }: { groups: NavGroup[]; hotline: string }) {
  const pathname = usePathname();
  // 換頁時自動收合手機選單：記下開啟時的路徑，路徑不同就視為關閉
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuOpen = openedAt === pathname;

  return (
    <header className="sticky top-0 z-40 bg-white shadow-sm">
      <div className="bg-brand-deep text-xs text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-1.5">
          <p className="truncate">InsurHack 模擬網站，非官方｜所有保戶資料均為範例</p>
          <div className="hidden shrink-0 items-center gap-4 sm:flex">
            <Link href={SITE_ROUTES.glossary} data-tour-id="header-glossary" className="hover:underline">
              秒懂保險專有名詞
            </Link>
            <span>客服專線 {hotline}</span>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href={SITE_ROUTES.home} data-tour-id="header-logo" className="flex items-baseline gap-2 py-1">
          <span className="text-xl font-bold tracking-wide text-brand md:text-2xl">法國巴黎人壽</span>
          <span className="rounded border border-brand px-1 text-[11px] text-brand">模擬</span>
        </Link>

        <nav aria-label="主選單" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {groups.map((group) => (
              <li key={group.label} className="group relative">
                <NavItem
                  link={group}
                  className="block px-3 py-2 text-[15px] font-medium text-ink"
                />
                {group.children.length > 0 && (
                  <ul className="invisible absolute left-0 top-full z-50 min-w-56 border-t-2 border-brand bg-white py-2 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    {group.children.map((child) => (
                      <li key={child.label}>
                        <NavItem link={child} className="block px-4 py-1.5 text-sm text-ink" />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={`${SITE_ROUTES.online}#online-membership`}
            data-tour-id="header-login"
            className="inline-flex min-h-9 items-center rounded-full bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
          >
            保戶專區登入
          </Link>
          <button
            type="button"
            className="p-2 text-ink lg:hidden"
            aria-label={menuOpen ? "關閉選單" : "開啟選單"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setOpenedAt(menuOpen ? null : pathname)}
          >
            <span aria-hidden className="block text-2xl leading-none">
              {menuOpen ? "×" : "☰"}
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-menu"
          aria-label="主選單"
          className="max-h-[calc(100dvh-7rem)] overflow-y-auto border-t border-neutral-200 bg-white px-4 pb-4 lg:hidden"
        >
          {groups.map((group) => (
            <details key={group.label} className="border-b border-neutral-100">
              <summary className="cursor-pointer py-3 font-medium text-ink">{group.label}</summary>
              <ul className="pb-2 pl-3">
                {group.children.map((child) => (
                  <li key={child.label}>
                    <NavItem link={child} className="block py-1.5 text-sm text-ink" />
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <Link href={SITE_ROUTES.glossary} className="block py-3 text-sm text-brand">
            秒懂保險專有名詞
          </Link>
        </nav>
      )}
    </header>
  );
}
