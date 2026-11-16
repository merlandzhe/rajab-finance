"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const API = "/api/notifications/unread";
const BELL = 'a.notification-dot[href="/crm/notifications"]';

export function MerchantUnreadIndicator() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname?.startsWith("/crm")) return;
    let disposed = false;
    let count = 0;
    let didRead = false;
    let reading = false;

    function draw() {
      if (disposed) return;
      const link = document.querySelector<HTMLAnchorElement>(BELL);
      if (!link) return;
      const dot = link.querySelector<HTMLElement>(".hesap-live-unread-dot");
      if (count > 0 && !dot) {
        const element = document.createElement("span");
        element.className = "hesap-live-unread-dot";
        element.setAttribute("aria-hidden", "true");
        link.append(element);
      } else if (!count && dot) {
        dot.remove();
      }
      const label = count > 0
        ? "Уведомления: " + count + " непрочитанных"
        : "Уведомления";
      if (link.getAttribute("aria-label") !== label)
        link.setAttribute("aria-label", label);
    }

    async function refresh() {
      if (disposed || document.visibilityState === "hidden") return;
      try {
        const response = await fetch(API, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const data: { count?: number } = await response.json();
        if (disposed) return;
        count = Math.max(0, Math.min(999, Number(data.count) || 0));
        draw();
      } catch {
        // Keep the last known status on temporary network errors.
      }
    }

    async function markRead() {
      if (disposed || reading || didRead || pathname !== "/crm/notifications") return;
      const heading = document.querySelector(".merchant-app .page-heading h1");
      if (heading?.textContent?.trim() !== "Уведомления") return;
      reading = true;
      try {
        const response = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok || disposed) return;
        didRead = true;
        count = 0;
        draw();
        await refresh();
      } catch {
        // The badge will remain until the server confirms it was viewed.
      } finally {
        reading = false;
      }
    }

    let queued = false;
    const changed = () => {
      if (queued || disposed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        draw();
        if (pathname === "/crm/notifications") void markRead();
      });
    };
    const observer = new MutationObserver(changed);
    observer.observe(document.body, { childList: true, subtree: true });
    const focused = () => { void refresh(); };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(focused, 45000);
    changed();
    void refresh();
    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname]);

  return null;
}
