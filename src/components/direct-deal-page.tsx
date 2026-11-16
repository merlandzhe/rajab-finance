"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, BadgeCheck, BookOpenCheck, CheckCircle2, CircleX, ClipboardList, FileText, House, Plus, Users, Wallet } from "lucide-react";
import type { State, Application } from "@/lib/types";
import { addMonths, calculate, cents, money, today } from "@/lib/money";

const statuses: Record<string, string> = {
  draft:"Черновик",review:"На рассмотрении",clarification:"На рассмотрении",
  approved:"Ожидает оформления",awaiting_purchase:"На рассмотрении",
  purchased:"На рассмотрении",ready_to_sell:"На рассмотрении",
  rejected:"Отклонена",contracted:"Договор подготовлен"
};
function startingMarkup(a: Application|undefined, s: State["settings"][number]|undefined) {
  if (a?.final_quote?.profit != null && Number(a.estimated_cost)>0) {
    return (Math.round(Number(a.final_quote.profit)*10000/Number(a.estimated_cost))/100).toString();
  }
  if (s?.mode==="fixed") return (s.fixed_bps/100).toString();
  if (s?.mode==="term" && a) return ((s.term_rates[String(a.months)] ?? 0)/100).toString();
  return "0";
}
function ownEstimate(a: Application, pct: string) {
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(pct.trim())) throw Error("Наценка от 0 до 100%");
  const basisPoints=Math.round(Number(pct.replace(",","."))*100);
  if (!Number.isInteger(basisPoints)||basisPoints<0||basisPoints>10000)
    throw Error("Наценка от 0 до 100%");
  const cost=BigInt(a.estimated_cost);
  const profit=(cost*BigInt(basisPoints)+5000n)/10000n;
  const total=cost+profit;
  const rest=total-BigInt(a.down_payment);
  if (rest<=0n) throw Error("Взнос должен быть меньше полной стоимости");
  return {basisPoints,profit:profit.toString(),price:total.toString(),
    monthly:(rest/BigInt(a.months)).toString()};
}
export function DirectDealPage({data,id,isNew}:{data:State;id:string;isNew:boolean}) {
  const router=useRouter();
  const app=data.applications.find(a=>a.id===id);
  const contract=app && data.contracts.find(c=>c.application_id===app.id);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [price,setPrice]=useState("120000");
  const [down,setDown]=useState("0");
  const [months,setMonths]=useState(6);
  const [customer,setCustomer]=useState("");
  const [available,setAvailable]=useState(false);
  const [markup,setMarkup]=useState(()=>startingMarkup(app,data.settings[0]));
  let fresh:ReturnType<typeof calculate>|null=null;
  let customized:ReturnType<typeof ownEstimate>|null=null;
  try {
    if (isNew && data.settings[0]) fresh=calculate({
      cost:cents(price),down:cents(down),months,
      firstDate:addMonths(today(),1),pricing:data.settings[0]
    });
  } catch {fresh=null;}
  try {if(app)customized=ownEstimate(app,markup);}catch{/*Display validation separately*/}

  async function submit(url:string, payload:unknown,returnTo?:string){
    setBusy(true);setError("");
    try {
      const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",body:JSON.stringify(payload)});
      const result=await r.json();
      if(!r.ok)throw Error(result.error||"Не удалось выполнить действие");
      if(returnTo==="contract" && result.id){
        router.push("/contracts/"+result.id+"/view");
      } else {
        router.push("/crm/applications/"+(result.id||id));
      }
      router.refresh();
    } catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  const nav:[string,string,React.ElementType][]=[
    ["/crm","Обзор",House],["/crm/applications","Заявки",ClipboardList],
    ["/crm/customers","Клиенты",Users],["/crm/payments","Платежи",Wallet],
    ["/crm/settings","Ещё",FileText]
  ];
  return <div className="hd-page merchant-app">
    <header className="hd-header">
      <Link href="/crm" className="hd-brand"><BookOpenCheck size={26}/> HESAP</Link>
      <Link href="/crm/notifications" className="hd-bell">Уведомления</Link>
    </header>
    <main className="hd-main">
      <Link className="hd-back" href="/crm/applications"><ArrowLeft size={18}/> Вернуться к заявкам</Link>
      <div className="hd-eyebrow">HESAP · Бизнес</div>
      <h1>{isNew?"Новая заявка":app?.product_name||"Заявка"}</h1>
      {isNew? <>
        <p className="hd-muted">Укажите стоимость и срок — платёж рассчитается сразу.</p>
        <form className="hd-card hd-form" onSubmit={e=>{
          e.preventDefault();const form=new FormData(e.currentTarget);
          if(!fresh){setError("Проверьте тариф, стоимость и срок");return;}
          void submit("/api/command",{
            action:"application.create",key:crypto.randomUUID(),
            payload:{customer_id:customer,product_name:String(form.get("product_name")),
              product_url:"",supplier:"",estimated_cost:cents(price),
              down_payment:cents(down),months,notes:String(form.get("notes")||"")}
          });
        }}>
          <label>Клиент<select required value={customer} onChange={e=>setCustomer(e.target.value)}>
            <option value="">Выберите клиента</option>
            {data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
          <label>Товар<input name="product_name" required minLength={2} maxLength={160} placeholder="Например, iPhone"/></label>
          <div className="hd-fields">
            <label>Стоимость товара, ₽<input inputMode="decimal" required value={price} onChange={e=>setPrice(e.target.value)}/></label>
            <label>Первоначальный взнос, ₽<input inputMode="decimal" required value={down} onChange={e=>setDown(e.target.value)}/></label>
          </div>
          <label>Срок, месяцев<input type="number" min={1} max={36} value={months} onChange={e=>setMonths(Number(e.target.value))}/></label>
          <label>Комментарий<textarea name="notes" rows={2}/></label>
          {fresh&&<div className="hd-quote">
            <div><span>Полная цена</span><strong>{money(fresh.price)}</strong></div>
            <div className="hd-highlight"><span>Ежемесячно</span><strong>{money(fresh.each)}</strong></div>
          </div>}
          {error&&<p role="alert" className="hd-error">{error}</p>}
          <button className="hd-primary" disabled={busy||!fresh||!customer}><Plus size={18}/> {busy?"Сохраняем…":"Создать заявку"}</button>
          {!data.customers.length&&<Link href="/crm/customers/new">Сначала добавьте клиента</Link>}
        </form>
      </>:app?<>
        <div className="hd-card">
          <div className="hd-row"><span className="hd-muted">Статус</span>
            <span className={"hd-status"+(app.status==="rejected"?" hd-rejected":"")}>{statuses[app.status]||app.status}</span>
          </div>
          <h2>{app.product_name}</h2>
          <div className="hd-data">
            <div><span>Клиент</span><strong>{data.customers.find(c=>c.id===app.customer_id)?.name||"—"}</strong></div>
            <div><span>Цена товара</span><strong>{money(app.estimated_cost)}</strong></div>
            <div><span>Взнос</span><strong>{money(app.down_payment)}</strong></div>
            <div><span>Срок</span><strong>{app.months} месяцев</strong></div>
          </div>
          {app.notes&&<p className="hd-note">{app.notes}</p>}
        </div>
        {contract?<div className="hd-card">
          <div className="hd-row"><h2>Договор оформлен</h2><BadgeCheck size={23} color="#cba96e"/></div>
          <div className="hd-quote">
            <div><span>Наценка</span><strong>{startingMarkup(app,data.settings[0])}%</strong></div>
            <div><span>Полная цена</span><strong>{money(contract.sale_price)}</strong></div>
            <div className="hd-highlight"><span>Ежемесячно</span>
              <strong>{money((BigInt(contract.sale_price)-BigInt(contract.down_payment))/BigInt(contract.months))}</strong></div>
          </div>
          <p className="hd-note">{contract.status==="awaiting_acceptance"
            ?"Ожидается подтверждение покупателя."
            :"Условия договора подтверждены."}</p>
          <Link className="hd-primary" href={"/contracts/"+contract.id+"/view"}><FileText size={18}/> Посмотреть договор</Link>
          <Link className="hd-secondary" href="/crm">Вернуться в кабинет</Link>
        </div>:app.status!=="rejected"?<div className="hd-card">
          <h2>Условия договора</h2>
          <p className="hd-note">Можно назначить отдельную наценку этому покупателю. Изменение действует только для данного договора.</p>
          <label className="hd-markup-field">Наценка для этого клиента, %
            <input inputMode="decimal" type="number" min={0} max={100} step="0.01"
              value={markup} onChange={e=>setMarkup(e.target.value)} placeholder="25"/>
          </label>
          <div className="hd-quote">
            <div><span>Стоимость товара</span><strong>{money(app.estimated_cost)}</strong></div>
            <div><span>Наценка · {markup||"—"}%</span><strong>{customized?money(customized.profit):"—"}</strong></div>
            <div><span>Итоговая цена</span><strong>{customized?money(customized.price):"—"}</strong></div>
            <div><span>Первоначальный взнос</span><strong>{money(app.down_payment)}</strong></div>
            <div className="hd-highlight"><span>Ежемесячно · {app.months} мес.</span>
              <strong>{customized?money(customized.monthly):"—"}</strong></div>
            <small>Последний платёж может отличаться из-за округления. Окончательные условия увидит покупатель до подтверждения.</small>
          </div>
          <label className="hd-check"><input type="checkbox" checked={available} onChange={e=>setAvailable(e.target.checked)}/>
            <span>Подтверждаю наличие товара для продажи по этим условиям.</span>
          </label>
          {error&&<p role="alert" className="hd-error">{error}</p>}
          <button className="hd-primary" disabled={busy||!available||!customized}
            onClick={()=>customized && void submit("/api/direct-installment",{
              action:"approve",id:app.id,available:true,markupBps:customized.basisPoints},"contract")}>
            <CheckCircle2 size={19}/> {busy?"Оформляем…":"Одобрить и создать договор"}
          </button>
          {(app.status==="review"||app.status==="clarification")&&
            <button className="hd-secondary" disabled={busy}
              onClick={()=>void submit("/api/command",{
                action:"application.transition",key:crypto.randomUUID(),
                payload:{id:app.id,status:"rejected"}})}>
              <CircleX size={17}/> Отклонить заявку
            </button>}
        </div>:<div className="hd-card">Заявка отклонена.</div>}
      </>:<div className="hd-card">Заявка не найдена или недоступна.</div>}
    </main>
    <nav className="hd-nav" aria-label="Навигация HESAP">
      {nav.map(([href,label,Icon])=><Link key={href} href={href} className={href==="/crm/applications"?"active":""}>
        <Icon size={21}/><span>{label}</span></Link>)}
    </nav>
  </div>;
}
