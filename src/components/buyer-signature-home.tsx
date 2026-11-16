"use client";
import {useEffect,useMemo,useState} from "react";
import {createPortal} from "react-dom";
import Link from "next/link";
import Decimal from "decimal.js";
import {CalendarDays,ChevronRight} from "lucide-react";
import type {State,Session} from "@/lib/types";
import {contractDebt,contractPaid} from "@/lib/metrics";
import {scheduleOverview} from "@/lib/cabinet-overview";
import {money,sum,today} from "@/lib/money";

export function BuyerSignatureHome({data,session}:{data:State;session:Session}){
 const [mount,setMount]=useState<HTMLElement|null>(null);
 const result=useMemo(()=>{
   const active=data.contracts.filter(c=>["signed","transferred","closed"].includes(c.status));
   const total=sum(active.map(c=>c.sale_price));
   const paid=sum(active.map(c=>contractPaid(data,c.id)));
   const owed=sum(active.map(c=>Decimal.max(0,new Decimal(contractDebt(data,c))).toString()));
   const percent=new Decimal(total).gt(0)?Math.min(100,Math.max(0,new Decimal(paid).div(total).mul(100).toNumber())):0;
   const next=scheduleOverview(data,today()).filter(p=>!p.paid)[0];
   return {total,paid,owed,percent,next};
 },[data]);
 useEffect(()=>{
   let original:HTMLElement|null=null;
   let slot:HTMLElement|null=null;
   function attach(){
     const old=document.querySelector<HTMLElement>(".buyer-app .portfolio-card");
     if(!old){if(original)original.classList.remove("sv-replaced");slot?.remove();slot=null;original=null;setMount(null);return;}
     if(original===old && slot?.isConnected)return;
     if(original)original.classList.remove("sv-replaced");
     slot?.remove();
     if(!old.parentElement)return;
     slot=document.createElement("div");
     slot.className="sv-buyer-slot";
     old.parentElement.insertBefore(slot,old);
     old.classList.add("sv-replaced");
     original=old;setMount(slot);
   }
   attach();const watch=new MutationObserver(attach);
   watch.observe(document.body,{subtree:true,childList:true});
   return ()=>{watch.disconnect();if(original)original.classList.remove("sv-replaced");slot?.remove();};
 },[]);
 if(!mount)return null;
 const firstName=(session.name||"Покупатель").trim().split(/\s+/)[0];
 return createPortal(<div className="sv-buyer-home">
   <section className="sv-buyer-hero">
     <span>ЛИЧНЫЙ КАБИНЕТ</span>
     <h2>Здравствуйте, {firstName}!</h2>
     <p>Ваши покупки в рассрочку</p>
   </section>
   <section className="sv-balance">
     <span>Осталось выплатить</span><strong>{money(result.owed)}</strong>
     <div className="sv-progress" role="progressbar" aria-label="Выплачено" aria-valuenow={Math.round(result.percent)} aria-valuemin={0} aria-valuemax={100}><div style={{width:result.percent+"%"}}/></div>
     <div className="sv-balance-footer"><span>Выплачено <b>{money(result.paid)}</b></span><span>Общая сумма <b>{money(result.total)}</b></span></div>
   </section>
   {result.next&&<Link className="sv-buyer-next" href="/cabinet/contracts">
     <CalendarDays size={24}/><span><small>Следующий платёж</small><strong>{money(result.next.remaining)}</strong></span><ChevronRight size={20}/>
   </Link>}
 </div>,mount);
}
