"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpenCheck, House, ShoppingBag, FileText, Wallet, UserRound, ArrowLeft, CheckCircle2, Clock3, ChevronRight } from "lucide-react";
import type { State, Contract } from "@/lib/types";
import { money } from "@/lib/money";

export function BuyerContractsPage({ data }: { data: State }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState<string[]>([]);
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const pending = data.contracts.filter(c => c.status === "awaiting_acceptance" && !accepted.includes(c.id));
  const confirmed = data.contracts.filter(c => c.status !== "awaiting_acceptance" || accepted.includes(c.id));
  const product = (id: string) => data.contract_items.find(item => item.contract_id === id)?.product_name ?? "Покупка в рассрочку";
  const nav = [
    { href:"/cabinet", label:"Главная", Icon:House },
    { href:"/cabinet?view=applications", label:"Заявки", Icon:ShoppingBag },
    { href:"/cabinet/contracts", label:"Договоры", Icon:FileText },
    { href:"/cabinet?view=payments", label:"Платежи", Icon:Wallet },
    { href:"/cabinet?view=profile", label:"Профиль", Icon:UserRound },
  ];

  async function confirm(contract: Contract) {
    if (!agreed[contract.id] || busy) return;
    setBusy(contract.id);
    setError(previous => ({ ...previous, [contract.id]: "" }));
    setSuccess("");
    try {
      const response = await fetch("/api/direct-installment", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ action:"accept", id:contract.id, agreed:true }),
        credentials:"same-origin",
        cache:"no-store"
      });
      const result: { ok?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || "Не удалось подтвердить договор");
      setAccepted(previous => [...previous, contract.id]);
      setSuccess("Договор подтверждён и перенесён в раздел «Оформленные». Теперь доступен график платежей.");
      setAgreed(previous => ({ ...previous, [contract.id]: false }));
      router.refresh();
    } catch(e) {
      setError(previous => ({ ...previous, [contract.id]: e instanceof Error ? e.message : "Проверьте соединение и повторите" }));
    } finally { setBusy(null); }
  }

  return <div className="hesap-contracts-page buyer-app">
    <header className="hesap-contracts-head">
      <Link href="/cabinet" className="hesap-contracts-brand"><BookOpenCheck size={24}/> HESAP</Link>
      <Link href="/cabinet" className="hesap-contracts-home"><ArrowLeft size={17}/> На главную</Link>
    </header>
    <main className="hesap-contracts-content">
      <div className="hesap-contracts-kicker">Личный кабинет</div>
      <h1>Мои договоры</h1>
      <p className="hesap-contracts-intro">Здесь можно подтвердить новый договор, посмотреть условия и открыть график платежей.</p>
      {success && <p role="status" className="hesap-contracts-success"><CheckCircle2 size={18}/> {success}</p>}
      <section className="hesap-contracts-section">
        <div className="hesap-contracts-section-title"><h2>На подтверждении</h2><span>{pending.length}</span></div>
        {pending.length === 0
          ? <div className="hesap-contracts-empty"><CheckCircle2 size={24}/><strong>Нет договоров на подтверждении</strong><p>После оформления продавцом новые договоры появятся здесь.</p></div>
          : pending.map(contract => {
            const monthly=(BigInt(contract.sale_price)-BigInt(contract.down_payment))/BigInt(contract.months);
            return <article className="hesap-contracts-card" key={contract.id}>
              <div className="hesap-contracts-cardtop"><span className="hesap-contracts-tag pending"><Clock3 size={14}/> Ожидает подтверждения</span><small>{contract.number}</small></div>
              <h3>{product(contract.id)}</h3>
              <div className="hesap-contracts-pair"><span>Полная стоимость</span><strong>{money(contract.sale_price)}</strong></div>
              <div className="hesap-contracts-pair"><span>Первоначальный взнос</span><strong>{money(contract.down_payment)}</strong></div>
              <div className="hesap-contracts-pair featured"><span>Ежемесячно · {contract.months} мес.</span><strong>{money(monthly)}</strong></div>
              <Link className="hesap-contracts-outline" href={"/contracts/"+contract.id+"/view"}>Посмотреть договор и график <ChevronRight size={17}/></Link>
              <label className="hesap-contracts-consent">
                <input type="checkbox" checked={Boolean(agreed[contract.id])} onChange={e=>setAgreed(previous=>({ ...previous, [contract.id]:e.target.checked }))}/>
                <span>Я ознакомился с условиями договора и согласен с ними.</span>
              </label>
              {error[contract.id] && <p className="hesap-contracts-error" role="alert">{error[contract.id]}</p>}
              <button type="button" className="hesap-contracts-primary" disabled={!agreed[contract.id] || Boolean(busy)} onClick={()=>void confirm(contract)}>
                {busy===contract.id?"Подтверждаем…":"Подтвердить договор"}
              </button>
              <p className="hesap-contracts-disclaimer">Подтверждение фиксируется в HESAP. Юридическую силу электронного согласия определяют условия соглашения сторон и закон.</p>
            </article>;
          })}
      </section>
      <section className="hesap-contracts-section">
        <div className="hesap-contracts-section-title"><h2>Оформленные</h2><span>{confirmed.length}</span></div>
        {confirmed.length === 0
          ? <div className="hesap-contracts-empty"><FileText size={24}/><strong>Пока нет оформленных договоров</strong><p>Они появятся здесь после вашего подтверждения.</p></div>
          : confirmed.map(contract => <article className="hesap-contracts-card" key={contract.id}>
              <div className="hesap-contracts-cardtop"><span className="hesap-contracts-tag complete"><CheckCircle2 size={14}/> {contract.status==="closed"?"Завершён":contract.status==="transferred"?"Действует":"Подтверждён"}</span><small>{contract.number}</small></div>
              <h3>{product(contract.id)}</h3>
              <div className="hesap-contracts-pair"><span>Полная стоимость</span><strong>{money(contract.sale_price)}</strong></div>
              <div className="hesap-contracts-pair"><span>Срок</span><strong>{contract.months} месяцев</strong></div>
              <Link className="hesap-contracts-outline" href={"/contracts/"+contract.id+"/view"}>Открыть договор <ChevronRight size={17}/></Link>
              <Link className="hesap-contracts-text-link" href={"/cabinet?view=payments&contract="+contract.id}>График и платежи</Link>
            </article>)}
      </section>
    </main>
    <nav className="pocket-nav hesap-contracts-bottom" aria-label="Кабинет покупателя">
      {nav.map(({href,label,Icon})=><Link key={href} href={href} className={label==="Договоры"?"active":""} aria-current={label==="Договоры"?"page":undefined}><Icon size={20}/><span>{label}</span></Link>)}
    </nav>
  </div>;
}
