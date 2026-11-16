"use client";
import {useMemo,useState} from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import {BookOpenCheck,Search,ArrowLeft,ChevronRight,ChevronDown,FileText,Plus,Users,Wallet,Check,Phone,House,ShoppingBag,MoreHorizontal,ArrowUpRight,SlidersHorizontal,RefreshCcw} from "lucide-react";
import type {Customer,Contract,State} from "@/lib/types";
import {contractDebt,contractPaid} from "@/lib/metrics";
import {sum,money} from "@/lib/money";

type Filter="all"|"debt"|"paid"|"none";
type Sort="new"|"name"|"debt";
type ClientRow={customer:Customer,contracts:Contract[],total:string,paid:string,owed:string,ratio:number};
const nonnegative=(value:string)=>Decimal.max(0,new Decimal(value)).toString();
const firstLetters=(name:string)=>name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join("");
const safePhone=(raw:string)=>raw.replace(/[^\d+]/g,"");
const groups:[Filter,string][]=[["all","Все"],["debt","С долгом"],["paid","Погашено"],["none","Без договоров"]];

export function PremiumCustomers({customers,contracts,data}:{customers:Customer[];contracts:Contract[];data:State}){
 const [filter,setFilter]=useState<Filter>("all");
 const [sort,setSort]=useState<Sort>("name");
 const [search,setSearch]=useState("");
 const [selected,setSelected]=useState<string|null>(null);
 const [limit,setLimit]=useState(20);
 const rows=useMemo<ClientRow[]>(()=>{
  const grouped=new Map<string,Contract[]>();
  for(const c of contracts){
   if(!["signed","transferred","closed"].includes(c.status))continue;
   const list=grouped.get(c.customer_id)||[];
   list.push(c);grouped.set(c.customer_id,list);
  }
  return customers.map(customer=>{
    const group=(grouped.get(customer.id)||[]).filter(c=>c.tenant_id===customer.tenant_id);
    const total=sum(group.map(c=>c.sale_price));
    const paid=sum(group.map(c=>contractPaid(data,c.id)));
    const owed=sum(group.map(c=>nonnegative(contractDebt(data,c))));
    const ratio=new Decimal(total).gt(0)?Math.min(100,Math.max(0,new Decimal(paid).div(total).mul(100).toNumber())):0;
    return {customer,contracts:group,total,paid,owed,ratio};
  });
 },[customers,contracts,data]);
 const debtors=rows.filter(x=>new Decimal(x.owed).gt(0));
 const allOwed=sum(rows.map(x=>x.owed));
 const visible=useMemo(()=>{
  const q=search.trim().toLocaleLowerCase("ru-RU");
  return rows.filter(x=>{
   if(filter==="debt"&&!new Decimal(x.owed).gt(0))return false;
   if(filter==="paid"&&(!x.contracts.length||new Decimal(x.owed).gt(0)))return false;
   if(filter==="none"&&x.contracts.length)return false;
   return !q||[x.customer.name,x.customer.phone,x.customer.email??""].some(t=>t.toLocaleLowerCase("ru-RU").includes(q));
  }).sort((a,b)=>{
   if(sort==="name")return a.customer.name.localeCompare(b.customer.name,"ru");
   if(sort==="debt")return new Decimal(b.owed).cmp(a.owed);
   return b.customer.created_at.localeCompare(a.customer.created_at);
  });
 },[rows,filter,sort,search]);
 const shown=visible.slice(0,limit);
 const actions=[
  {href:"/crm",label:"Обзор",Icon:House},
  {href:"/crm/applications",label:"Заявки",Icon:ShoppingBag},
  {href:"/crm/customers",label:"Клиенты",Icon:Users},
  {href:"/crm/payments",label:"Платежи",Icon:Wallet},
  {href:"/crm/settings",label:"Ещё",Icon:MoreHorizontal}
 ];
 return <div className="cx-page">
  <header className="cx-header">
   <Link className="cx-brand" href="/crm"><BookOpenCheck size={27}/>HESAP</Link>
   <Link className="cx-back" href="/crm"><ArrowLeft size={17}/> Обзор</Link>
  </header>
  <main className="cx-main">
   <section className="cx-hero">
    <span className="cx-eyebrow">HESAP · БИЗНЕС</span>
    <h1>Клиенты</h1>
    <p>Договоры, платежи и задолженность — в одном месте</p>
   </section>
   <section className="cx-stats" aria-label="Сводка по клиентам">
    <div className="cx-stat"><Users size={18}/><span>Всего клиентов</span><strong>{rows.length}</strong></div>
    <div className="cx-stat"><Wallet size={18}/><span>С задолженностью</span><strong>{debtors.length}</strong></div>
   </section>
   <div className="cx-owed"><span>Осталось выплатить по договорам</span><strong>{money(allOwed)}</strong></div>
   <div className="cx-actions">
    <Link className="cx-new" href="/crm/customers/new"><Plus size={20}/> Новый клиент</Link>
    <Link className="cx-advanced" href="/crm/customers/legacy">Расширенный список <ArrowUpRight size={17}/></Link>
   </div>
   <section className="cx-directory">
    <div className="cx-section-heading"><h2>Мои клиенты</h2><span>{visible.length}</span></div>
    <label className="cx-search">
     <Search size={20}/><input type="search" value={search} placeholder="Поиск по имени или телефону"
      aria-label="Поиск клиентов" onChange={e=>{setSearch(e.target.value);setLimit(20);}}/>
    </label>
    <div className="cx-tools">
     <div className="cx-filters" aria-label="Фильтр клиентов">
      {groups.map(([id,label])=><button type="button" key={id} aria-pressed={filter===id}
        className={filter===id?"active":""} onClick={()=>{setFilter(id);setLimit(20);}}>{label}</button>)}
     </div>
     <label className="cx-sort"><SlidersHorizontal size={16}/>
      <span>Сортировка</span>
      <select value={sort} aria-label="Сортировка клиентов" onChange={e=>setSort(e.target.value as Sort)}>
       <option value="name">По имени</option><option value="debt">По сумме долга</option><option value="new">Сначала новые</option>
      </select>
     </label>
    </div>
    <div className="cx-list">
     {shown.length===0&&<div className="cx-empty"><Search size={24}/><strong>Клиенты не найдены</strong><span>Попробуйте другой поиск или фильтр.</span><button type="button" onClick={()=>{setSearch("");setFilter("all");}}>Сбросить фильтры</button></div>}
     {shown.map(row=>{
      const active=row.customer.id===selected;
      const hasDebt=new Decimal(row.owed).gt(0);
      return <article className={"cx-card"+(active?" selected":"")} key={row.customer.id}>
       <button type="button" className="cx-card-main" onClick={()=>setSelected(active?null:row.customer.id)} aria-expanded={active} aria-label={"Открыть данные клиента "+row.customer.name}>
        <span className="cx-avatar">{firstLetters(row.customer.name)||"К"}</span>
        <span className="cx-person"><strong>{row.customer.name}</strong><small>{row.customer.phone||"Телефон не указан"}</small></span>
        <span className="cx-selection">{active?<Check size={18}/>:<ChevronDown size={18}/>}</span>
       </button>
       <div className="cx-card-details">
        <div><FileText size={15}/><span>Договоры</span><strong>{row.contracts.length}</strong></div>
        <div><Wallet size={15}/><span>Осталось выплатить</span><strong>{money(row.owed)}</strong></div>
       </div>
       {row.contracts.length>0&&<div className="cx-progress" role="progressbar" aria-label="Погашено по договорам" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.ratio)}><div style={{width:row.ratio+"%"}}/></div>}
       <div className="cx-card-status"><span>{row.contracts.length===0?"Нет оформленных договоров":hasDebt?"Активная задолженность":"Все платежи погашены"}</span>{row.contracts.length>0&&<span>{Math.round(row.ratio)}% оплачено</span>}</div>
       {active&&<div className="cx-expanded">
        <div className="cx-expanded-total"><span>Выплачено</span><strong>{money(row.paid)}</strong><span>Общая сумма</span><strong>{money(row.total)}</strong></div>
        {row.contracts.length>0&&<div className="cx-contracts">{row.contracts.map(c=><Link key={c.id} href={"/contracts/"+c.id+"/view"} className="cx-contract">
         <FileText size={17}/><span><strong>{data.contract_items.find(x=>x.contract_id===c.id)?.product_name||"Договор "+c.number}</strong><small>{c.number}</small></span><ChevronRight size={17}/>
        </Link>)}</div>}
        <div className="cx-card-links">
         {row.customer.phone&&<a href={"tel:"+safePhone(row.customer.phone)}><Phone size={17}/> Позвонить</a>}
         <Link href="/crm/payments"><Wallet size={17}/> Платежи</Link>
         <Link href="/crm/customers/legacy"><FileText size={17}/> Управление</Link>
        </div>
       </div>}
      </article>;
     })}
    </div>
    {visible.length>shown.length&&<button type="button" className="cx-load" onClick={()=>setLimit(x=>x+20)}>Показать ещё {Math.min(20,visible.length-shown.length)} <ChevronDown size={16}/></button>}
    <p className="cx-note">Суммы рассчитываются по договорам и подтверждённым платежам. Данные клиентов не изменяются.</p>
   </section>
  </main>
  <nav className="cx-nav" aria-label="Навигация предпринимателя">
   {actions.map(({href,label,Icon})=><Link key={href} href={href} aria-current={label==="Клиенты"?"page":undefined} className={label==="Клиенты"?"active":""}>
    <Icon size={21}/><span>{label}</span>
   </Link>)}
  </nav>
 </div>;
}