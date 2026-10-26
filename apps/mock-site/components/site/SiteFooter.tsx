import Link from "next/link";
import { SITE_ROUTES } from "./routes";

export function SiteFooter({
  hotline,
  address,
  datasetDate,
}: {
  hotline: string;
  address: string;
  datasetDate: string;
}) {
  return (
    <footer className="mt-auto bg-neutral-800 text-sm text-neutral-300">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-3">
        <div>
          <p className="text-base font-semibold text-white">法國巴黎人壽（模擬）</p>
          <p className="mt-2">{address}</p>
          <p className="mt-1">免付費服務／申訴專線 {hotline}</p>
        </div>
        <ul className="space-y-0">
          <li><Link href={SITE_ROUTES.services} className="inline-flex min-h-9 items-center hover:text-white">保戶服務</Link></li>
          <li><Link href={SITE_ROUTES.forms} className="inline-flex min-h-9 items-center hover:text-white">常用表單下載</Link></li>
          <li><Link href={SITE_ROUTES.claims} className="inline-flex min-h-9 items-center hover:text-white">理賠程序介紹</Link></li>
          <li><Link href={SITE_ROUTES.online} className="inline-flex min-h-9 items-center hover:text-white">網路保險服務</Link></li>
          <li><Link href={SITE_ROUTES.faq} data-tour-id="footer-faq" className="inline-flex min-h-9 items-center hover:text-white">常見問題</Link></li>
        </ul>
        <p className="leading-relaxed">
          {`本站內容整理自法國巴黎人壽官網公開資訊（資料集整理日期 ${datasetDate}；各頁「資料來源」標示該頁條目的擷取日期），`}
          僅供競賽展示，實際規定以官方公告為準。
        </p>
      </div>
      <p
        data-tour-id="footer-disclaimer"
        className="border-t border-neutral-700 px-4 py-3 text-center font-medium text-white"
      >
        InsurHack 模擬網站，非官方
      </p>
    </footer>
  );
}
