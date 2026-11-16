"use client";
import Link from "next/link";
import {useMemo,useState} from "react";
import Decimal from "decimal.js";
import {ArrowUpRight,BarChart3,CalendarClock,ChevronRight,CircleAlert,Clock3,FileText,Plus,Search,ShoppingBag,Wallet} from "lucide-react";
import type {State,Session} from "@/lib/types";
import {scheduleOverview} from "@/lib/cabinet-overview";
import {money,sum,today} from "@/lib/money";
import {contractDebt} from "@/lib/metrics";

function formatDate(s:string){
 return new Date(s+"T12:00:00Z").toLocaleDateString("ru-RU",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
}
function initials(s:string){return s.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0].toUpperCase()).join("");}
export function MerchantOverview({data,session}:{data:State;session:Session}){
 const [period,setPeriod]=useState<"next"|"late">("next");
 const [query,setQuery]=useState("");
 const day=today();
 const due=useMemo(()=>scheduleOverview(data,day).filter(p=>!p.paid),[data,day]);
 const late=due.filter(p=>p.overdue);
 const upcoming=due.filter(p=>!p.overdue);
 const todayRows=due.filter(p=>p.due_on===day);
 const newApps=data.applications.filter(x=>x.status==="review");
 const saleContracts=data.contracts.filter(c=>["signed","transferred","closed"].includes(c.status));
 const owed=sum(saleContracts.map(c=>Decimal.max(0,new Decimal(contractDebt(data,c))).toString()));
 const filtered=(period==="late"?late:upcoming).filter(p=>[p.customer?.name,p.product,p.contract.number].some(s=>(s||"").toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU")))).slice(0,5);
 const canReview=session.role==="owner"||session.role==="manager";
 return <div className="sv-merchant">
  <section className="sv-hero">
    <span className="sv-eyebrow">HESAP · БИЗНЕС</span>
    <h1>Обзор бизнеса</h1>
    <p>Заявки, платежи и клиенты — всё под контролем</p>
  </section>
  <div className="sv-kpis">
    <Link href="/crm/applications" className="sv-kpi">
      <ShoppingBag size={23}/><span>Новые заявки</span><strong>{newApps.length}</strong><small>Ожидают решения <ChevronRight size={15}/></small>
    </Link>
    <Link href="/crm/calendar" className="sv-kpi">
      <Wallet size={23}/><span>Платежи сегодня</span><strong className="sv-money">{money(sum(todayRows.map(p=>p.remaining)))}</strong><small>{todayRows.length} по графику <ChevronRight size={15}/></small>
    </Link>
    <Link href="/crm/calendar" className={"sv-kpi"+(late.length>0?" sv-late":"")}>
      <CircleAlert size={23}/><span>Просрочки</span><strong>{late.length}</strong><small>Требуют внимания <ChevronRight size={15}/></small>
    </Link>
    <Link href="/crm/contracts" className="sv-kpi">
      <FileText size={23}/><span>Договоры</span><strong>{saleContracts.length}</strong><small>Учёт рассрочек <ChevronRight size={15}/></small>
    </Link>
  </div>
  <Link href="/crm/calendar" className="sv-owed">
    <span>Общий остаток по договорам</span><strong>{money(owed)}</strong><small>Открыть график платежей <ArrowUpRight size={15}/></small>
  </Link>
  <h2 className="sv-section-title">Быстрые действия</h2>
  <div className="sv-actions">
    <Link href="/crm/applications"><ShoppingBag size={23}/><span>{canReview?"Рассмотреть заявки":"Все заявки"}</span></Link>
    <Link href="/crm/customers/new"><Plus size={25}/><span>Добавить клиента</span></Link>
    <Link href="/crm/calendar"><BarChart3 size={24}/><span>График платежей</span></Link>
  </div>
  <div className="sv-section-head">
    <div><h2>Ближайшие платежи</h2><p>Кого ждать и кому напомнить</p></div>
    <Link href="/crm/calendar">Все <ArrowUpRight size={15}/></Link>
  </div>
  <div className="sv-payment-controls">
    <div className="sv-switch">
      <button type="button" className={period==="next"?"current":""} aria-pressed={period==="next"} onClick={()=>setPeriod("next")}>По графику</button>
      <button type="button" className={period==="late"?"current":""} aria-pressed={period==="late"} onClick={()=>setPeriod("late")}>Просрочено</button>
    </div>
    <label className="sv-find"><Search size={18}/><input type="search" placeholder="Найти клиента" value={query} onChange={e=>setQuery(e.target.value)}/></label>
  </div>
  <div className="sv-payment-list">
    {filtered.length===0?<div className="sv-empty"><Clock3 size={24}/><strong>Нет неоплаченных платежей</strong><small>Можно посмотреть другой период в календаре</small></div>:filtered.map(p=><Link key={p.id} className="sv-payment" href={"/contracts/"+p.contract.id+"/view"}>
      <span className="sv-avatar">{initials(p.customer?.name||"К")}</span>
      <span className="sv-payment-info"><strong>{p.customer?.name||"Клиент"}</strong><small>{formatDate(p.due_on)} · {p.product}</small></span>
      <span className="sv-payment-sum">{money(p.remaining)}</span>
    </Link>)}
  </div>
  <div className="sv-section-head sv-apps-head"><div><h2>Новые заявки</h2><p>Ожидают решения: {newApps.length}</p></div><Link href="/crm/applications">Все <ArrowUpRight size={15}/></Link></div>
  {newApps.slice(0,3).map(app=><Link key={app.id} href="/crm/applications" className="sv-application">
     <span><strong>{data.customers.find(c=>c.id===app.customer_id)?.name||"Клиент"}</strong><small>{app.product_name}</small></span><ChevronRight size={18}/>
  </Link>)}
 </div>;
}
