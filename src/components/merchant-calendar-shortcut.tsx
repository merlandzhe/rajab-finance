"use client";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight, CalendarClock } from "lucide-react";
export function MerchantCalendarShortcut(){
 const path=usePathname();
 const [slot,setSlot]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  if(path!=="/crm"){setSlot(null);return;}
  let mount:HTMLElement|null=null;
  const attach=()=>{
   if(mount?.isConnected)return;
   const target=document.querySelector<HTMLElement>(".merchant-upgrade");
   if(!target)return;
   mount=document.createElement("div");
   mount.className="pc-shortcut-mount";
   target.insertBefore(mount,target.firstChild);
   setSlot(mount);
  };
  attach();
  const observer=new MutationObserver(attach);
  observer.observe(document.body,{subtree:true,childList:true});
  return()=>{observer.disconnect();mount?.remove();setSlot(null)};
 },[path]);
 if(path!=="/crm"||!slot)return null;
 return createPortal(<Link href="/crm/calendar" className="pc-shortcut">
  <span className="pc-shortcut-icon"><CalendarClock size={24}/></span>
  <span className="pc-shortcut-text">
   <strong>Платёжный календарь</strong>
   <small>Сегодня · 7 дней · Просрочки</small>
  </span>
  <ArrowUpRight size={21}/>
 </Link>,slot);
}
