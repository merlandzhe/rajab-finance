"use client";
import Link from "next/link";
import { useMemo,useState } from "react";
import { ArrowLeft, ArrowRight, BookOpenCheck, CalendarClock, CheckCircle2, CircleAlert, Clock3, FileText, House, Search, ShoppingBag, Users, Wallet, MoreHorizontal } from "lucide-react";
import Decimal from "decimal.js";
import { scheduleOverview } from "@/lib/cabinet-overview";
import { contractDebt,datePlus } from "@/lib/metrics";
import { money,sum,today } from "@/lib/money";
import type { State } from "@/lib/types";

type Period = "today"|"week"|"month"|"overdue"|"all";
const PERIODS:{id:Period;label:string}[]=[
 {id:"today",label:"Сегодня"}, {id:"week",label:"7 дней"},
 {id:"month",label:"30 дней"}, {id:"overdue",label:"Просрочено"},
 {id:"all",label:"Все"}
];
function prettyDate(iso:string) {
 const [y,m,d]=iso.split("-").map(Number);
 return new Intl.DateTimeFormat("ru-RU",{
  day:"numeric",month:"short",year:"numeric",timeZone:"UTC"
 }).format(new Date(Date.UTC(y,m-1,d)));
}
export function MerchantPaymentCalendar({data}:{data:State}){
 const [period,setPeriod]=useState<Period>("week");
 const [query,setQuery]=useState("");
 const [showAll,setShowAll]=useState(false);
 const day=today();
 const weekEnd=datePlus(day,6),monthEnd=datePlus(day,29);
 const entries=useMemo(()=>scheduleOverview(data,day).filter(item=>!item.paid),[data,day]);
 const pendingAmount=(from:string,to:string)=>sum(entries.filter(row=>row.due_on>=from&&row.due_on<=to).map(row=>row.remaining));
 const past=entries.filter(row=>row.due_on<day);
 const overdueAmount=sum(past.map(row=>row.remaining));
 const totalDebt=sum(data.contracts
  .filter(c=>["signed","transferred","closed"].includes(c.status))
  .map(c=>Decimal.max(new Decimal(0),new Decimal(contractDebt(data,c))).toString()));
 const pendingClaims=data.payment_claims.filter(p=>p.status==="pending").length;
 const stats=[
  {id:"overdue" as const,title:"Просрочено",amount:overdueAmount,count:past.length},
  {id:"today" as const,title:"Платежи сегодня",amount:pendingAmount(day,day),count:entries.filter(row=>row.due_on===day).length},
  {id:"week" as const,title:"Ближайшие 7 дней",amount:pendingAmount(day,weekEnd),count:entries.filter(row=>row.due_on>=day&&row.due_on<=weekEnd).length},
  {id:"month" as const,title:"Ближайшие 30 дней",amount:pendingAmount(day,monthEnd),count:entries.filter(row=>row.due_on>=day&&row.due_on<=monthEnd).length}
 ];
 const normalized=query.trim().toLocaleLowerCase("ru-RU");
 const filtered=entries.filter(row=>{
  if(period==="today"&&row.due_on!==day)return false;
  if(period==="week"&&(row.due_on<day||row.due_on>weekEnd))return false;
  if(period==="month"&&(row.due_on<day||row.due_on>monthEnd))return false;
  if(period==="overdue"&&!row.overdue)return false;
  if(!normalized)return true;
  return [row.customer?.name,row.product,row.contract.number,row.customer?.phone]
   .some(value=>String(value||"").toLocaleLowerCase("ru-RU").includes(normalized));
 });
 const visible=showAll?filtered:filtered.slice(0,20);
 const show = (id:Period)=>{setPeriod(id);setShowAll(false)};
 const navbar=[
  {href:"/crm",label:"Обзор",Icon:House},
  {href:"/crm/applications",label:"Заявки",Icon:ShoppingBag},
  {href:"/crm/customers",label:"Клиенты",Icon:Users},
  {href:"/crm/payments",label:"Платежи",Icon:Wallet},
  {href:"/crm/settings",label:"Ещё",Icon:MoreHorizontal}
 ];
 return <div className="pc-page">
  <header className="pc-header">
   <Link href="/crm" className="pc-brand"><BookOpenCheck size={25}/> HESAP</Link>
   <Link href="/crm" className="pc-back"><ArrowLeft size={17}/> Кабинет</Link>
  </header>
  <main className="pc-main">
   <div className="pc-eyebrow">HESAP · Бизнес</div>
   <h1>Контроль платежей</h1>
   <p className="pc-subtitle">Что должны оплатить сегодня, в ближайшие дни и какие платежи уже просрочены.</p>
   <div className="pc-stats">
    {stats.map(stat=><button key={stat.id} className={"pc-stat "+(period===stat.id?"selected":"")} type="button" onClick={()=>show(stat.id)}>
      <span className="pc-stat-label">{stat.title}{stat.id==="overdue"?<CircleAlert size={17}/>:<CalendarClock size={17}/>}</span>
      <strong>{money(stat.amount)}</strong>
      <small>{stat.count} {stat.count===1?"платёж":"платежей"} <ArrowRight size={13}/></small>
    </button>)}
   </div>
   <div className="pc-total">
     <span>Общая непогашенная сумма по активным договорам</span>
     <strong>{money(totalDebt)}</strong>
   </div>
   {pendingClaims>0&&<div className="pc-notice">
    <Clock3 size={19}/>
    <span>Ожидают проверки сообщения об оплате: <strong>{pendingClaims}</strong>. До подтверждения они не уменьшают задолженность.</span>
    <Link href="/crm/payments">Проверить <ArrowRight size={15}/></Link>
   </div>}
   <section className="pc-panel">
    <div className="pc-sectionhead">
     <h2>График к получению</h2>
     <Link href="/crm/payments">Все платежи <ArrowRight size={16}/></Link>
    </div>
    <div className="pc-chips" aria-label="Период платежей">
      {PERIODS.map(item=><button type="button" key={item.id}
        className={period===item.id?"active":""}
        aria-pressed={period===item.id}
        onClick={()=>show(item.id)}>{item.label}</button>)}
    </div>
    <label className="pc-search"><Search size={19}/>
     <input value={query} onChange={e=>{setQuery(e.target.value);setShowAll(false)}}
       placeholder="Поиск по клиенту, товару или договору" autoComplete="off" />
    </label>
    <div className="pc-list-title">
      <span>Найдено: {filtered.length}</span>
      <strong>{money(sum(filtered.map(x=>x.remaining)))}</strong>
    </div>
    <div className="pc-list">
     {!visible.length&&<div className="pc-empty"><CheckCircle2 size={24}/><strong>Нет неоплаченных платежей</strong><p>По выбранному периоду задолженностей нет.</p></div>}
     {visible.map(row=><article className="pc-entry" key={row.id}>
      <div className="pc-entry-top">
       <span className={"pc-status "+(row.overdue?"late":"next")}>
        {row.overdue?<CircleAlert size={14}/>:<CalendarClock size={14}/>}
        {row.overdue?"Просрочено":row.due_on===day?"Сегодня":"По графику"}
       </span>
       <span className="pc-date">{prettyDate(row.due_on)}</span>
      </div>
      <h3>{row.customer?.name||"Покупатель"}</h3>
      <p>{row.product}</p>
      <div className="pc-entry-foot">
       <div><span>Остаток платежа</span><strong>{money(row.remaining)}</strong></div>
       <Link href={"/contracts/"+row.contract.id+"/view"} aria-label={"Открыть договор "+row.contract.number}>
        <FileText size={17}/> Договор
       </Link>
      </div>
     </article>)}
    </div>
    {!showAll&&filtered.length>20&&<button className="pc-more" onClick={()=>setShowAll(true)} type="button">
      Показать ещё {filtered.length-20} платежей
    </button>}
   </section>
   <div className="pc-actions">
    <Link href="/crm/payments"><Wallet size={19}/> Отметить оплату <ArrowRight size={17}/></Link>
    <Link href="/crm/customers/new"><Users size={19}/> Добавить рассрочку <ArrowRight size={17}/></Link>
   </div>
   <p className="pc-footnote">Суммы рассчитаны по графикам существующих договоров с учётом подтверждённых оплат. Это ожидаемые, а не гарантированные поступления.</p>
  </main>
  <nav className="pc-nav" aria-label="Навигация предпринимателя">
   {navbar.map(({href,label,Icon})=><Link href={href} key={href} className={label==="Платежи"?"active":""}>
    <Icon size={20}/><span>{label}</span>
   </Link>)}
  </nav>
 </div>;
}
