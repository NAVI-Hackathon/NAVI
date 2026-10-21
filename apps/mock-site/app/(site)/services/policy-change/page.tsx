import type { Metadata } from "next";
import { PageBody, PageHeader, SourceNote } from "@/components/site/PageHeader";
import { SITE_ROUTES } from "@/components/site/routes";
import { Tabs } from "@/components/site/Tabs";
import { toKebab } from "@/components/site/tour-ids";
import { ServiceDetail } from "../../_components/ServiceDetail";
import { datasetDate, servicesByCategory } from "../../_lib/seed";

export const metadata: Metadata = { title: "保單變更" };

/** 分頁標籤用的短名稱（官網標籤文字較短） */
const SHORT_LABELS: Record<string, string> = {
  change_address: "地址變更",
  change_name: "姓名變更",
  change_policyholder: "要保人變更",
  change_insured_id: "被保險人資料",
  change_beneficiary: "受益人變更",
  change_dividend_option: "紅利給付方式",
  change_payment_method: "繳費方式",
  change_payment_frequency: "繳別變更",
  change_occupation: "職業變更",
  supplementary_health_disclosure: "補充健康告知",
  contact_info_chain: "保全聯盟鏈",
};

export default function PolicyChangePage() {
  const services = servicesByCategory("保單變更");
  const tabs = services.map((service) => ({
    id: toKebab(service.id),
    label: SHORT_LABELS[service.id] ?? service.name,
    content: <ServiceDetail service={service} />,
  }));

  return (
    <>
      <PageHeader
        title="保單變更"
        crumbs={[{ label: "保戶服務", href: SITE_ROUTES.services }, { label: "保單變更" }]}
      />
      <PageBody>
        <p className="mb-6 text-[15px] leading-relaxed text-muted">
          請選擇欲辦理的變更項目，填妥申請書後郵寄至本公司，或留下資料由專人與您聯繫。
        </p>
        <Tabs label="變更項目" items={tabs} />
        <SourceNote sources={services} datasetDate={datasetDate} />
      </PageBody>
    </>
  );
}
