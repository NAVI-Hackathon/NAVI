import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader, SourceNote } from "@/components/site/PageHeader";
import { SITE_ROUTES } from "@/components/site/routes";
import { Tabs } from "@/components/site/Tabs";
import { ServiceDetail } from "../../_components/ServiceDetail";
import { datasetDate, getService, seed } from "../../_lib/seed";

export const metadata: Metadata = { title: "理賠程序介紹" };

export default function ClaimsPage() {
  const byMail = getService("claim_by_mail");
  const unionChain = getService("claim_union_chain");
  const hospitalUpload = getService("claim_hospital_upload");
  const household = getService("claim_household_registration");
  const requirements = Object.entries(seed.claim_document_requirements);

  const tabs = [
    {
      id: "claim-by-mail",
      label: "理賠申請流程",
      content: (
        <ServiceDetail service={byMail}>
          <h3 className="mt-6 font-bold text-ink">理賠申請注意事項</h3>
          <ol data-tour-id="claim-general-rules" className="mt-2 list-decimal space-y-1 pl-5 text-[15px] leading-relaxed">
            {seed.claim_general_rules.map((rule, index) => (
              <li key={rule} data-tour-id={`claim-rule-${index + 1}`}>{rule}</li>
            ))}
          </ol>
        </ServiceDetail>
      ),
    },
    {
      id: "claim-documents",
      label: "應備文件",
      content: (
        <div className="overflow-x-auto">
          <table data-tour-id="claim-documents-table" className="w-full min-w-[32rem] border-t-2 border-brand text-[15px]">
            <caption className="sr-only">各類理賠應備文件</caption>
            <thead className="bg-brand-light text-left text-sm text-brand-deep">
              <tr>
                <th scope="col" className="w-40 px-3 py-2">理賠項目</th>
                <th scope="col" className="px-3 py-2">應備文件</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map(([type, documents], index) => (
                <tr key={type} data-tour-id={`claim-doc-${index + 1}`} className="border-b border-neutral-200 align-top">
                  <th scope="row" className="px-3 py-3 text-left font-medium">{type}</th>
                  <td className="px-3 py-3">{documents.join("、")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      id: "claim-union-chain",
      label: "理賠聯盟鏈",
      content: <ServiceDetail service={unionChain} />,
    },
    {
      id: "claim-hospital-upload",
      label: "保險理賠醫起通",
      content: (
        <ServiceDetail service={hospitalUpload}>
          <h3 className="mt-6 font-bold text-ink">合作醫療院所</h3>
          <ul
            data-tour-id="claim-hospital-list"
            className="mt-2 grid gap-x-4 gap-y-1 text-[15px] sm:grid-cols-2 lg:grid-cols-3"
          >
            {(hospitalUpload.partner_hospitals ?? []).map((name) => (
              <li key={name} className="before:mr-1.5 before:text-brand before:content-['•']">{name}</li>
            ))}
          </ul>
        </ServiceDetail>
      ),
    },
    {
      id: "claim-household-registration",
      label: "戶政連線",
      content: <ServiceDetail service={household} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="理賠程序介紹"
        crumbs={[{ label: "保戶服務", href: SITE_ROUTES.services }, { label: "理賠程序介紹" }]}
      />
      <PageBody>
        <p className="mb-6 text-[15px] leading-relaxed text-muted">
          申請理賠前請先確認您投保的險種（請參閱保單首頁），理賠表單請至
          <Link href={`${SITE_ROUTES.forms}#forms-claim`} data-tour-id="claims-forms-link" className="mx-1 text-brand underline-offset-2 hover:underline">
            常用表單下載
          </Link>
          頁面取得。
        </p>
        <Tabs label="理賠服務" items={tabs} />
        <SourceNote sources={[byMail]} datasetDate={datasetDate} />
      </PageBody>
    </>
  );
}
