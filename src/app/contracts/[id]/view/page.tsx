import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { money } from "@/lib/money";
import { DownloadContractPdf } from "@/components/download-contract-pdf";
import "./preview.css";

export const dynamic = "force-dynamic";

export default async function ContractPreview({
  params,
}: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const id = z.uuid().parse((await params).id);
  const data = await getState(user);
  const contract = data.contracts.find(c => c.id === id);
  if (!contract) notFound();
  const buyer = user.role === "client";
  const back = buyer ? "/cabinet/contracts" : "/crm/applications/" + contract.application_id;
  const home = buyer ? "/cabinet" : "/crm";
  const item = data.contract_items.find(x => x.contract_id === contract.id);
  const seller = data.organizations.find(x => x.id === contract.tenant_id)?.name || "Магазин";
  const customer = data.customers.find(x => x.id === contract.customer_id)?.name || "Покупатель";
  const schedule = data.payment_schedules
    .filter(x => x.contract_id === contract.id)
    .sort((a,b) => a.sequence - b.sequence);
  const pct = Number(contract.cost) > 0 ? 100*Number(contract.profit)/Number(contract.cost) : 0;
  const pctText = pct.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  const monthly = (BigInt(contract.sale_price)-BigInt(contract.down_payment))/BigInt(contract.months);
  return <main className="cv-root">
    <header className="cv-head">
      <Link href={home} className="cv-logo">▣ HESAP</Link>
      <Link href={back} className="cv-close">← К договорам</Link>
    </header>
    <div className="cv-body">
      <Link href={back} className="cv-return">← Назад к договорам</Link>
      <p className="cv-eyebrow">Договор рассрочки</p>
      <h1>{item?.product_name || "Покупка в рассрочку"}</h1>
      <p className="cv-muted">{contract.number} · {contract.status === "awaiting_acceptance"
        ? "Ожидает подтверждения покупателя"
        : "Условия подтверждены"}</p>
      <section className="cv-card">
        <div className="cv-pair"><span>Продавец</span><strong>{seller}</strong></div>
        <div className="cv-pair"><span>Покупатель</span><strong>{customer}</strong></div>
        <div className="cv-pair"><span>Стоимость товара</span><strong>{money(contract.cost)}</strong></div>
        <div className="cv-pair"><span>Наценка</span><strong>{pctText}% · {money(contract.profit)}</strong></div>
        <div className="cv-pair"><span>Первоначальный взнос</span><strong>{money(contract.down_payment)}</strong></div>
        <div className="cv-pair cv-total"><span>Итоговая цена</span><strong>{money(contract.sale_price)}</strong></div>
        <div className="cv-pair cv-emphasis"><span>Ежемесячно · {contract.months} мес.</span><strong>{money(monthly)}</strong></div>
      </section>
      <section className="cv-card">
        <h2>График платежей</h2>
        {schedule.map(row => <div className="cv-schedule" key={row.id}>
          <span>{row.sequence === 0 ? "Первоначальный взнос" : "Платёж №"+row.sequence}<small>{row.due_on}</small></span>
          <strong>{money(row.amount)}</strong>
        </div>)}
      </section>
      <section className="cv-card cv-actions">
        <p>Условия договора удобно читать здесь. PDF можно скачать отдельно.</p>
        <DownloadContractPdf id={id}/>
        <Link href={back} className="cv-back-button">
          {buyer ? "Вернуться к моим договорам" : "Вернуться к заявке"}
        </Link>
      </section>
      <p className="cv-legal">Юридическая сила электронного подписания определяется соглашением сторон и законодательством.</p>
    </div>
  </main>;
}
