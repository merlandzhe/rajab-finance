"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { addMonths, calculate, money, today } from "@/lib/money";
import type { State } from "@/lib/types";

/** Preserve the monthly payment summary on existing buyer application cards. */
export function BuyerApplicationMonthly() {
  const pathname=usePathname();
  const [data,setData]=useState<State|null>(null);
  const active=pathname==="/cabinet";
  useEffect(()=>{
    if(!active){setData(null);return;}
    let disposed=false;
    const load=async()=>{
      try{
        const r=await fetch("/api/state",{cache:"no-store",credentials:"same-origin"});
        if(!r.ok)return;
        const state:State=await r.json();
        if(!disposed)setData(state);
      }catch{/* Keep application cards visible without the summary. */}
    };
    void load();
    window.addEventListener("focus",load);
    return()=>{disposed=true;window.removeEventListener("focus",load);};
  },[active]);

  useEffect(()=>{
    if(!active||!data)return;
    let queued=false;
    const render=()=>{
      if(queued)return;queued=true;
      queueMicrotask(()=>{
        queued=false;
        const cards=document.querySelectorAll<HTMLElement>(".buyer-app .application-compose ~ .card.pad");
        cards.forEach((card,index)=>{
          const app=data.applications[index];
          if(!app)return;
          let summary=card.querySelector<HTMLElement>(".hesap-buyer-app-monthly");
          if(!summary){
            summary=document.createElement("p");
            summary.className="hesap-buyer-app-monthly";
            card.appendChild(summary);
          }
          try{
            const quote=app.final_quote?.sale_price&&app.final_quote?.monthly_payment
              ? {price:String(app.final_quote.sale_price),each:String(app.final_quote.monthly_payment)}
              : calculate({cost:app.estimated_cost,down:app.down_payment,months:app.months,
                  firstDate:addMonths(today(),1),pricing:data.settings[0]});
            const label="Ежемесячно: "+money(quote.each)+" · Полная цена: "+money(quote.price);
            if(summary.textContent!==label)summary.textContent=label;
          }catch{if(summary.textContent)summary.textContent="";}
        });
      });
    };
    render();
    const observer=new MutationObserver(render);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[active,data]);
  return null;
}
