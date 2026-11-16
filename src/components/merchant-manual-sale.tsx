"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, ArrowLeft, UserRoundPlus, ShoppingBag, CalendarDays, Calculator, CheckCircle2, House, Users, Wallet, MoreHorizontal } from "lucide-react";
import type { State } from "@/lib/types";

type Settings=State["settings"][number];
type Entry={number:number,date:string,amount:bigint};
type Preview={cost:bigint;down:bigint;profit:bigint;price:bigint;monthly:bigint;entries:Entry[];bps:number};
function parseRubles(value:string):bigint{
 const v=value.trim().replace(",",".");
 if(!/^\d{1,10}(\.\d{1,2})?$/.test(v))throw Error("Укажите сумму в рублях");
 const [whole,decimals=""]=v.split(".");
 return BigInt(whole)*100n+BigInt(decimals.padEnd(2,"0"));
}
function money(v:bigint){
 return (Number(v)/100).toLocaleString("ru-RU",{style:"currency",currency:"RUB",minimumFractionDigits:0,maximumFractionDigits:2});
}
const pad=(n:number)=>String(n).padStart(2,"0");
function shiftMonth(iso:string,offset:number){
 const [y,m,d]=iso.split("-").map(Number);
 const target=new Date(Date.UTC(y,m-1+offset,1));
 const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
 return target.getUTCFullYear()+"-"+pad(target.getUTCMonth()+1)+"-"+pad(Math.min(d,last));
}
function dateToday(){
 const d=new Date();
 return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
}
function readableDate(s:string){
 const [y,m,d]=s.split("-").map(Number);
 return new Date(Date.UTC(y,m-1,d)).toLocaleDateString("ru-RU",{
  day:"numeric",month:"short",year:"numeric",timeZone:"UTC"
 });
}
function rate(s:Settings|null,months:number){
 if(!s)return "0";
 const bps=s.mode==="fixed"?s.fixed_bps:s.mode==="term"?(s.term_rates[String(months)]??0):0;
 return String(bps/100);
}
function previewSale(cost:string,down:string,percent:string,months:number,firstDate:string,soldOn:string):Preview{
 const c=parseRubles(cost),d=parseRubles(down||"0");
 const normalized=percent.trim().replace(",",".");
 if(!/^\d{1,3}(\.\d{1,2})?$/.test(normalized))throw Error("Наценка: от 0 до 100%");
 const bps=Math.round(Number(normalized)*100);
 if(bps<0||bps>10000)throw Error("Наценка: от 0 до 100%");
 if(c<100n||c>100000000000n)throw Error("Стоимость должна быть положительной");
 if(!Number.isInteger(months)||months<1||months>36)throw Error("Срок от 1 до 36 месяцев");
 const today=dateToday();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(soldOn)||soldOn>today)
  throw Error("Дата продажи не может быть в будущем");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)||firstDate<soldOn)
  throw Error("Первый платёж должен быть не раньше даты продажи");
 const profit=(c*BigInt(bps)+5000n)/10000n;
 const price=c+profit,rest=price-d;
 if(d<0||rest<=0n)throw Error("Первый взнос должен быть меньше полной цены");
 const monthly=rest/BigInt(months);
 if(monthly<1n)throw Error("Слишком маленький платёж");
 return {cost:c,down:d,profit,price,monthly,bps,
  entries:Array.from({length:months},(_,i)=>({
   number:i+1,date:shiftMonth(firstDate,i),
   amount:i===months-1?rest-monthly*BigInt(months-1):monthly
  }))
 };
}
export function MerchantManualSale({settings}:{settings:Settings|null}){
 const router=useRouter();
 const [mode,setMode]=useState<"sale"|"customer">("sale");
 const [name,setName]=useState("");
 const [phone,setPhone]=useState("");
 const [product,setProduct]=useState("");
 const [cost,setCost]=useState("");
 const [down,setDown]=useState("0");
 const [months,setMonths]=useState(6);
 const [markup,setMarkup]=useState(()=>rate(settings,6));
 const [markupCustom,setMarkupCustom]=useState(false);
 const [soldOn,setSoldOn]=useState(dateToday);
 const [firstDue,setFirstDue]=useState(()=>shiftMonth(dateToday(),1));
 const [pastMethod,setPastMethod]=useState<"Наличные"|"СБП">("Наличные");
 const [paidDown,setPaidDown]=useState(false);
 const [paidSteps,setPaidSteps]=useState<number[]>([]);
 const [agreed,setAgreed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const key=useRef<string|null>(null);

 useEffect(()=>{if(!markupCustom)setMarkup(rate(settings,months));},[months,settings,markupCustom]);
 useEffect(()=>setPaidSteps(current=>current.filter(i=>i<=months)),[months]);
 const check=useMemo(()=>{
  try{return {value:previewSale(cost,down,markup,months,firstDue,soldOn),error:""};}
  catch(e){return {value:null,error:e instanceof Error?e.message:"Проверьте данные"};}
 },[cost,down,markup,months,firstDue,soldOn]);
 const detail=useMemo(()=>{
  const value=check.value;
  if(!value)return {paid:0n,remaining:0n,paidCount:0};
  const paid=value.entries.filter(e=>paidSteps.includes(e.number)).reduce((sum,e)=>sum+e.amount,0n)
   +(paidDown?value.down:0n);
  return {paid,remaining:value.price-paid,paidCount:paidSteps.length+(paidDown&&value.down>0n?1:0)};
 },[check.value,paidSteps,paidDown]);
 function changed(){key.current=null;setError("");}
 function toggleStep(n:number,on:boolean){
  setPaidSteps(list=>on?[...new Set([...list,n])].sort((a,b)=>a-b):list.filter(i=>i!==n));
  changed();
 }
 function markPast(){
  if(!check.value)return;
  const today=dateToday();
  setPaidSteps(check.value.entries.filter(x=>x.date<=today).map(x=>x.number));
  changed();
 }
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy)return;
  setError("");setBusy(true);
  try{
   const operationKey=key.current ||= crypto.randomUUID();
   if(mode==="sale"){
    const v=check.value;
    if(!v)throw Error(check.error||"Проверьте сумму и сроки");
    if(!agreed)throw Error("Подтвердите, что договор согласован и подписан вне HESAP");
    const res=await fetch("/api/manual-installment",{
     method:"POST",credentials:"same-origin",cache:"no-store",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({
      key:operationKey,name:name.trim(),phone:phone.trim(),product:product.trim(),
      cost:v.cost.toString(),down:v.down.toString(),markupBps:v.bps,
      months,firstDue,soldOn,
      paidSteps,paidDown:paidDown&&v.down>0n,pastMethod,offlineSigned:true
     })
    });
    const result=await res.json();
    if(!res.ok||!result.ok||!result.id)throw Error(result.error||"Не удалось записать оплату");
    router.push("/contracts/"+result.id+"/view");
    router.refresh();
   } else {
    if(!phone.trim())throw Error("Нужен телефон для записи клиента без продажи");
    const res=await fetch("/api/command",{
     method:"POST",headers:{"Content-Type":"application/json"},
     credentials:"same-origin",body:JSON.stringify({
      action:"customer.create",key:operationKey,
      payload:{name:name.trim(),phone:phone.trim(),email:"",notes:"Добавлен предпринимателем"}
     })
    });
    const result=await res.json();
    if(!res.ok)throw Error(result.error||"Не удалось добавить клиента");
    router.push("/crm/customers");router.refresh();
   }
  } catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить")}
  finally{setBusy(false);}
 }
 return <div className="ms-root">
  <header className="ms-header">
   <Link className="ms-logo" href="/crm"><BookOpenCheck size={26}/> HESAP</Link>
   <Link className="ms-header-back" href="/crm/customers"><ArrowLeft size={16}/> К клиентам</Link>
  </header>
  <main className="ms-content">
   <div className="ms-kicker">HESAP · Бизнес</div>
   <h1>{mode==="sale"?"Добавить рассрочку":"Новый клиент"}</h1>
   <p className="ms-subtitle">Запишите продажу и отметьте ранее оплаченные месяцы. Остаток долга рассчитается автоматически.</p>
   <div className="ms-segment" role="group" aria-label="Тип записи">
    <button type="button" className={mode==="sale"?"chosen":""} onClick={()=>{setMode("sale");changed()}}>
     <ShoppingBag size={17}/> Рассрочка
    </button>
    <button type="button" className={mode==="customer"?"chosen":""} onClick={()=>{setMode("customer");changed()}}>
     <UserRoundPlus size={17}/> Только клиент
    </button>
   </div>
   <form className="ms-form" onSubmit={e=>void submit(e)} onChange={changed}>
    <section className="ms-card">
     <div className="ms-section-heading"><UserRoundPlus size={20}/><h2>Покупатель</h2></div>
     <label>Фамилия и имя
      <input required minLength={2} maxLength={120} autoComplete="name" value={name}
       onChange={e=>setName(e.target.value)} placeholder="Например, Ахмед Дадаев"/>
     </label>
     <label>Телефон {mode==="sale"&&<span className="ms-optional">необязательно</span>}
      <input required={mode==="customer"} maxLength={24} autoComplete="tel" inputMode="tel"
       value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 999 123 45 67"/>
     </label>
    </section>
    {mode==="sale"&&<>
     <section className="ms-card">
      <div className="ms-section-heading"><ShoppingBag size={20}/><h2>Товар и условия</h2></div>
      <label>Что купил клиент
       <input required minLength={2} maxLength={160} value={product}
        onChange={e=>setProduct(e.target.value)} placeholder="iPhone, автомобиль, мебель…"/>
      </label>
      <div className="ms-fields">
       <label>Стоимость, ₽
        <input required inputMode="decimal" value={cost} onChange={e=>setCost(e.target.value)} placeholder="125000"/>
       </label>
       <label>Первоначальный взнос, ₽
        <input required inputMode="decimal" value={down} onChange={e=>setDown(e.target.value)} placeholder="0"/>
       </label>
      </div>
      <div className="ms-fields">
       <label>Наценка, %
        <input required type="number" min="0" max="100" step="0.01" inputMode="decimal" value={markup}
         onChange={e=>{setMarkup(e.target.value);setMarkupCustom(true)}}/>
       </label>
       <label>Срок, месяцев
        <select required value={months} onChange={e=>setMonths(Number(e.target.value))}>
         {Array.from({length:36},(_,i)=>i+1).map(m=><option key={m} value={m}>{m} мес.</option>)}
        </select>
       </label>
      </div>
      <div className="ms-fields">
       <label>Дата продажи
        <input type="date" required value={soldOn} onChange={e=>setSoldOn(e.target.value)}/>
       </label>
       <label>Первый платёж
        <input type="date" required value={firstDue} onChange={e=>setFirstDue(e.target.value)}/>
       </label>
      </div>
      <p className="ms-info">Для старого клиента укажите исходную дату продажи и первый платёж, даже если они уже прошли.</p>
     </section>
     <section className="ms-card">
      <div className="ms-section-heading"><Calculator size={20}/><h2>График рассрочки</h2></div>
      {check.value?<>
       <div className="ms-summary-row"><span>Стоимость товара</span><strong>{money(check.value.cost)}</strong></div>
       <div className="ms-summary-row"><span>Наценка · {markup}%</span><strong>{money(check.value.profit)}</strong></div>
       <div className="ms-summary-row"><span>Первый взнос</span><strong>{money(check.value.down)}</strong></div>
       <div className="ms-summary-row ms-total"><span>Полная стоимость</span><strong>{money(check.value.price)}</strong></div>
       <div className="ms-monthly"><span>Ежемесячный платёж</span><strong>{money(check.value.monthly)}</strong></div>
       <div className="ms-history-heading"><CalendarDays size={18}/><strong>Какие платежи уже оплачены?</strong></div>
       <p className="ms-history-note">Отметьте галочками уже полученные платежи. Можно выбрать отдельные месяцы.</p>
       <div className="ms-history-actions">
        <button type="button" onClick={markPast}>Отметить прошедшие по сроку</button>
        <button type="button" onClick={()=>{setPaidSteps([]);setPaidDown(false);changed()}}>Снять все отметки</button>
       </div>
       {check.value.down>0n&&<label className={"ms-history-row"+(paidDown?" paid":"")}>
        <input type="checkbox" checked={paidDown} onChange={e=>{setPaidDown(e.target.checked);changed()}}/>
        <span className="ms-history-row-text"><strong>Первоначальный взнос</strong><small>{readableDate(soldOn)}</small></span>
        <b>{money(check.value.down)}</b>
       </label>}
       <div className="ms-history-scroll">
        {check.value.entries.map(row=><label key={row.number} className={"ms-history-row"+(paidSteps.includes(row.number)?" paid":"")}>
         <input type="checkbox" checked={paidSteps.includes(row.number)}
          onChange={e=>toggleStep(row.number,e.target.checked)}/>
         <span className="ms-history-row-text">
          <strong>Платёж №{row.number}</strong>
          <small>{readableDate(row.date)}</small>
         </span>
         <b>{money(row.amount)}</b>
        </label>)}
       </div>
       {detail.paidCount>0&&<label>Как получали старые платежи?
        <select value={pastMethod} onChange={e=>setPastMethod(e.target.value as "Наличные"|"СБП")}>
         <option value="Наличные">Наличные</option><option value="СБП">СБП</option>
        </select>
       </label>}
       <div className="ms-history-result">
        <div><span>Уже оплачено</span><strong>{money(detail.paid)}</strong></div>
        <div><span>Осталось выплатить</span><strong>{money(detail.remaining)}</strong></div>
       </div>
       <p className="ms-history-warning">Исторические платежи уменьшат долг, но не увеличат кассу повторно. Фактические даты прошлых оплат не указываются: HESAP зафиксирует дату их переноса.</p>
      </>:<p className="ms-prompt">{cost?check.error:"Введите стоимость товара, чтобы появился график."}</p>}
     </section>
     <section className="ms-card ms-confirm">
      <label className="ms-checkbox">
       <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>
       <span>Подтверждаю, что условия рассрочки согласованы с покупателем и договор подписан вне HESAP; отмеченные платежи действительно были получены.</span>
      </label>
      <p>Отметка прошлой оплаты не производит новое списание или перевод. Это перенос уже совершённых операций в учёт.</p>
     </section>
    </>}
    {error&&<p className="ms-error" role="alert">{error}</p>}
    <button className="ms-submit" type="submit" disabled={busy||(mode==="sale"&&(!check.value||!agreed))}>
     <CheckCircle2 size={20}/>{busy?"Сохраняем…":mode==="sale"?"Сохранить рассрочку и оплаты":"Создать клиента"}
    </button>
   </form>
   <Link className="ms-more" href="/crm/customers">← Вернуться к списку клиентов</Link>
  </main>
  <nav className="ms-nav" aria-label="Кабинет предпринимателя">
   {[
    ["/crm","Обзор",House],["/crm/applications","Заявки",ShoppingBag],
    ["/crm/customers","Клиенты",Users],["/crm/payments","Платежи",Wallet],
    ["/crm/settings","Ещё",MoreHorizontal]
   ].map(([href,label,Icon])=><Link key={href as string} href={href as string} className={label==="Клиенты"?"current":""}>
    <Icon size={20}/><span>{label as string}</span>
   </Link>)}
  </nav>
 </div>;
}
