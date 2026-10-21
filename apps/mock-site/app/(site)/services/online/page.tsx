import type { Metadata } from "next";
import { PageBody, PageHeader, SourceNote } from "@/components/site/PageHeader";
import { SITE_ROUTES } from "@/components/site/routes";
import { Tabs } from "@/components/site/Tabs";
import { ServiceDetail } from "../../_components/ServiceDetail";
import { datasetDate, getService, seed } from "../../_lib/seed";

export const metadata: Metadata = { title: "網路保險服務" };

const ONLINE_PAGE_URL = "https://life.cardif.com.tw/zh/f8";

/** 線上功能項目 → data-tour-id 用的英文代號（online-feature-<slug>） */
const FEATURE_SLUGS: Record<string, string> = {
  我的投資表現: "investment-performance",
  我的保單內容: "policy-details",
  保單績效通知: "performance-notice",
  "標的變更紀錄/標的交易紀錄": "fund-transactions",
  保單變更進度及理賠進度查詢: "progress-inquiry",
  配息歷史紀錄及配息歸戶查詢: "dividend-history",
  繳費明細查詢: "payment-history",
  保單基本資料變更: "basic-info-change",
  電子單據服務申請: "ebill",
  標的轉換: "fund-switch",
  變更下期投資標的: "next-allocation",
  每月扣除額扣除順序變更: "deduction-order",
  單筆增額申購: "single-topup",
  "暫停扣款/恢復扣款": "pause-payment",
  保單價值部分提領: "partial-withdrawal",
  保戶投資風險屬性變更: "risk-profile",
  保單貸款: "policy-loan",
  信用卡卡效卡號變更: "credit-card-update",
};

function featureTourId(name: string, index: number) {
  return `online-feature-${FEATURE_SLUGS[name] ?? `item-${index}`}`;
}

export default function OnlinePage() {
  const membership = getService("online_service_membership");
  const faqs = seed.faq.filter((f) => f.source === ONLINE_PAGE_URL);
  const featureGroups = Object.entries(seed.online_service_features);

  const tabs = [
    {
      id: "online-membership",
      label: "會員申請",
      content: (
        <ServiceDetail service={membership}>
          <button
            type="button"
            disabled
            data-tour-id="online-register-button"
            className="mt-6 rounded-full bg-brand px-6 py-2 text-white disabled:opacity-60"
          >
            立即註冊（模擬網站不開放）
          </button>
        </ServiceDetail>
      ),
    },
    {
      id: "online-features",
      label: "線上服務項目",
      content: (
        <div className="grid gap-6 md:grid-cols-2">
          {featureGroups.map(([group, features]) => (
            <section key={group} className="rounded border border-neutral-200">
              <h2 className="bg-brand-light px-4 py-2 font-bold text-brand-deep">{group}</h2>
              <ul className="divide-y divide-neutral-100">
                {features.map((name, index) => (
                  <li key={name} data-tour-id={featureTourId(name, index)} className="px-4 py-2.5 text-[15px]">
                    {name}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ),
    },
    {
      id: "online-faq",
      label: "常見問題",
      content: (
        <div className="divide-y divide-neutral-200 border-t-2 border-brand">
          {faqs.map((faq, index) => (
            <details key={faq.q} data-tour-id={`online-faq-${index + 1}`} className="group">
              <summary className="cursor-pointer list-none px-3 py-3 font-medium marker:hidden">
                <span className="mr-2 text-brand">Q</span>
                {faq.q}
              </summary>
              <p className="px-3 pb-4 pl-8 text-[15px] leading-relaxed text-muted">{faq.a}</p>
            </details>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="網路保險服務"
        crumbs={[{ label: "保戶服務", href: SITE_ROUTES.services }, { label: "網路保險服務" }]}
      />
      <PageBody>
        <p className="mb-6 text-[15px] leading-relaxed text-muted">
          加入巴黎線上 My Cardif 會員，即可於網站或法國巴黎人壽 App 查詢保單並辦理部分變更服務。
        </p>
        <Tabs label="網路保險服務" items={tabs} />
        <SourceNote sources={[{ url: ONLINE_PAGE_URL }, ...faqs.map((f) => ({ url: f.source, retrievedAt: f.retrievedAt }))]} datasetDate={datasetDate} />
      </PageBody>
    </>
  );
}
