"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing, ChevronRight } from "lucide-react";

/** Adds a dedicated Notifications entry to the existing "Ещё" settings surface. */
export function MerchantNotificationsSettingsEntry() {
  const pathname = usePathname();
  const [slot,setSlot] = useState<HTMLElement|null>(null);
  useEffect(() => {
    if (!pathname.startsWith("/crm") || pathname.startsWith("/crm/notification-settings")) {
      setSlot(null); return;
    }
    let element: HTMLElement | null = null;
    function find() {
      if (element?.isConnected) return;
      // SellerSettings renders this heading inside its settings section.
      const headings = Array.from(
        document.querySelectorAll<HTMLElement>("main h1,main h2,main h3,section h2")
      );
      const target = headings.find(el => {
        const label=(el.textContent??"").trim().toLocaleLowerCase("ru-RU");
        return label==="мой магазин" || label==="настройки магазина"
          || label==="настройки" || label==="ещё" || label==="дополнительно";
      });
      if (!target) return;
      const section=target.closest("section");
      const anchor=section ?? target;
      const parent=anchor.parentElement;
      if (!parent) return;
      element=document.createElement("div");
      element.className="mns-settings-entry-slot";
      if (section) parent.insertBefore(element,section);
      else parent.insertBefore(element,target.nextSibling);
      setSlot(element);
    }
    find();
    const observer=new MutationObserver(find);
    observer.observe(document.body,{childList:true,subtree:true});
    return () => {observer.disconnect();element?.remove();setSlot(null);};
  },[pathname]);
  if (!slot) return null;
  return createPortal(<Link className="mns-settings-entry" href="/crm/notification-settings">
    <span className="mns-entry-icon"><BellRing size={21}/></span>
    <span className="mns-entry-text">
      <strong>Уведомления</strong>
      <small>Настроить сообщения Telegram</small>
    </span>
    <ChevronRight size={22}/>
  </Link>,slot);
}
