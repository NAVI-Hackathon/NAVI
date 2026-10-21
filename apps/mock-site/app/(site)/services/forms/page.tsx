import type { Metadata } from "next";
import type { ReactNode } from "react";
import { POLICY_TYPE_LABELS, type PolicyType } from "@/lib/contracts/response";
import { MockDownloadButton } from "@/components/site/MockDownloadButton";
import { PageBody, PageHeader, SourceNote } from "@/components/site/PageHeader";
import { SITE_ROUTES } from "@/components/site/routes";
import { Tabs } from "@/components/site/Tabs";
import { formTourId } from "@/components/site/tour-ids";
import { datasetDate, seed, type SeedForm } from "../../_lib/seed";

export const metadata: Metadata = { title: "常用表單下載" };

/**
 * 依 seed 的 note／name，這兩份表單在官網依保單類型拆成不同版本（官網痛點：要先知道保單類型才選得對）。
 * 版本拆分目前是依說明文字推得，待爬蟲資料補上各版本實際檔名後再調整。
 */
const VERSIONED_FORMS = new Set(["form_contract_change", "form_policyholder_change"]);
const VERSION_ORDER: PolicyType[] = ["investment", "protection", "participating"];

const CLAIM_SECTIONS = [
  { prefix: "claim_1.", title: "申請文件" },
  { prefix: "claim_2.", title: "填寫範例" },
  { prefix: "claim_3.", title: "申請須知" },
];

function FormRow({ tourId, name, note }: { tourId: string; name: string; note?: ReactNode }) {
  return (
    <tr data-tour-id={tourId} className="border-b border-neutral-200 align-top">
      <td className="px-3 py-3">
        <p className="font-medium">{name}</p>
        {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      </td>
      <td className="w-24 px-3 py-3 text-right">
        <MockDownloadButton />
      </td>
    </tr>
  );
}

function FormTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <table className="w-full border-t-2 border-brand text-[15px]">
      <caption className="sr-only">{caption}</caption>
      <thead className="bg-brand-light text-left text-sm text-brand-deep">
        <tr>
          <th scope="col" className="px-3 py-2">表單名稱</th>
          <th scope="col" className="px-3 py-2 text-right">檔案</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function policyFormRows(form: SeedForm) {
  if (!VERSIONED_FORMS.has(form.id)) {
    return <FormRow key={form.id} tourId={formTourId(form.id)} name={form.name} note={form.note} />;
  }
  return VERSION_ORDER.map((type) => (
    <FormRow
      key={`${form.id}-${type}`}
      tourId={formTourId(form.id, type)}
      name={`${form.name}（${POLICY_TYPE_LABELS[type]}）`}
      note={form.note}
    />
  ));
}

export default function FormsPage() {
  const policyForms = seed.forms.filter((f) => !f.id.startsWith("claim_"));
  const claimForms = seed.forms.filter((f) => f.id.startsWith("claim_"));

  const tabs = [
    {
      id: "forms-policy",
      label: "保全服務表單",
      content: (
        <FormTable caption="保全服務表單">{policyForms.map(policyFormRows)}</FormTable>
      ),
    },
    {
      id: "forms-claim",
      label: "理賠服務表單",
      content: (
        <div className="space-y-8">
          {CLAIM_SECTIONS.map((section) => (
            <div key={section.prefix}>
              <h2 className="mb-2 font-bold text-ink">{section.title}</h2>
              <FormTable caption={section.title}>
                {claimForms
                  .filter((f) => f.id.startsWith(section.prefix))
                  .map((form) => (
                    <FormRow key={form.id} tourId={formTourId(form.id)} name={form.name} note={form.note} />
                  ))}
              </FormTable>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="常用表單下載"
        crumbs={[{ label: "保戶服務", href: SITE_ROUTES.services }, { label: "常用表單下載" }]}
      />
      <PageBody>
        <p className="mb-6 text-[15px] leading-relaxed text-muted">
          各類申請書請依您的保單類型下載對應版本，部分表單有唯一文件編號，請勿影印使用。
        </p>
        <Tabs label="表單分類" items={tabs} />
        {/* 保全表單列在 a311（form.page）；其餘理賠表單出自 a314 */}
        <SourceNote
          sources={seed.forms.map((f) => ({ url: f.page ?? "https://life.cardif.com.tw/zh/a314", retrievedAt: f.retrievedAt }))}
          datasetDate={datasetDate}
        />
      </PageBody>
    </>
  );
}
