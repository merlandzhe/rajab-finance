"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Remove the old Telegram setup card from Overview; settings now owns the controls. */
export function MerchantOverviewLegacyTelegramCleanup() {
  const path = usePathname();
  useEffect(() => {
    if (path !== "/crm") return;
    const touched = new Set<HTMLElement>();
    function hideLegacy() {
      const headings = document.querySelectorAll<HTMLElement>("main h2,main h3,section h2");
      for (const heading of headings) {
        const title=(heading.textContent||"").replace(/\s+/g," ").trim().toLocaleLowerCase("ru-RU");
        if (title!=="уведомления telegram" && title!=="telegram-уведомления") continue;
        const parent=heading.closest<HTMLElement>("section") ?? heading.closest<HTMLElement>(".card");
        if (!parent || parent.classList.contains("mns-legacy-hidden")) continue;
        parent.classList.add("mns-legacy-hidden");
        touched.add(parent);
      }
    }
    hideLegacy();
    const observer=new MutationObserver(hideLegacy);
    observer.observe(document.body,{subtree:true,childList:true});
    return () => {
      observer.disconnect();
      touched.forEach(el=>el.classList.remove("mns-legacy-hidden"));
    };
  }, [path]);
  return null;
}
