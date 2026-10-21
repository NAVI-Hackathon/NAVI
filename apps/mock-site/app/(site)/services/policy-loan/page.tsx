import type { Metadata } from "next";
import { PageBody, PageHeader, SourceNote } from "@/components/site/PageHeader";
import { SITE_ROUTES } from "@/components/site/routes";
import { Tabs } from "@/components/site/Tabs";
import { ServiceDetail } from "../../_components/ServiceDetail";
import { datasetDate, getService } from "../../_lib/seed";

export const metadata: Metadata = { title: "保單借款" };

export default function PolicyLoanPage() {
  const loan = getService("policy_loan");
  const repayment = getService("loan_repayment");

  const tabs = [
    { id: "policy-loan", label: "保單借款", content: <ServiceDetail service={loan} /> },
    { id: "loan-repayment", label: "借款還款", content: <ServiceDetail service={repayment} /> },
  ];

  return (
    <>
      <PageHeader
        title="保單借款"
        crumbs={[{ label: "保戶服務", href: SITE_ROUTES.services }, { label: "保單借款" }]}
      />
      <PageBody>
        <Tabs label="保單借款" items={tabs} />
        <SourceNote sources={[loan, repayment]} datasetDate={datasetDate} />
      </PageBody>
    </>
  );
}
