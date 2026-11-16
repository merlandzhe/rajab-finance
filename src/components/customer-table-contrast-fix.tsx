"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Improves only the customers table in the merchant CRM.
 * No change to table rows, handlers, contracts, or customer records.
 */
export function CustomerTableContrastFix() {
  const pathname = usePathname();
  useEffect(() => {
    const active = pathname === "/crm/customers";
    document.body.classList.toggle("hesap-customers-view", active);
    if (!active) return () => {
      document.body.classList.remove("hesap-customers-view");
    };

    function decorate() {
      const tables = document.querySelectorAll<HTMLTableElement>("table");
      for (const table of tables) {
        if (table.classList.contains("hesap-customer-table")) continue;
        const titles = Array.from(table.querySelectorAll("thead th, thead td"))
          .map(cell => (cell.textContent || "").trim().toLocaleLowerCase("ru-RU"))
          .join(" ");
        if ((titles.includes("клиент") || titles.includes("имя"))
          && titles.includes("телефон")
          && (titles.includes("договор") || titles.includes("задолж"))) {
          table.classList.add("hesap-customer-table");
        }
      }
    }
    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.body.classList.remove("hesap-customers-view");
      document.querySelectorAll(".hesap-customer-table").forEach(table =>
        table.classList.remove("hesap-customer-table"));
    };
  }, [pathname]);
  return null;
}
