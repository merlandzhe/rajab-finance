"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const PAYMENT_REVIEW_URL = "/crm/payments?view=review";
const PREVIOUS_LABEL = "Отметить оплату";
const REVIEW_LABEL = "Подтвердить оплату";

/**
 * Compatibility enhancement for the merchant dashboard.
 * The existing, server-validated PaymentWorkspace handles all actual
 * confirmations and manual records. This shortcut only opens its review tab.
 */
export function MerchantPaymentShortcut() {
  const router = useRouter();

  useEffect(() => {
    let queued = false;
    const isDashboard = () =>
      /^\/crm(?:\/(?:dashboard|overview))?\/?$/.test(window.location.pathname);

    const synchronize = () => {
      if (!isDashboard()) return;
      const scope = document.querySelector(".merchant-overview");
      if (!scope) return;
      const controls = scope.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>(
        "a, button",
      );
      for (const control of controls) {
        if (!(control.textContent ?? "").includes(PREVIOUS_LABEL)) continue;
        const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.textContent?.includes(PREVIOUS_LABEL)) {
            node.textContent = node.textContent.replace(
              PREVIOUS_LABEL,
              REVIEW_LABEL,
            );
          }
        }
        control.dataset.hesapPaymentReview = "true";
        control.setAttribute("aria-label", REVIEW_LABEL);
        control.setAttribute(
          "title",
          "Открыть оплаты, которые ждут подтверждения",
        );
        if (control instanceof HTMLAnchorElement) {
          control.setAttribute("href", PAYMENT_REVIEW_URL);
        }
      }
    };

    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        synchronize();
      });
    };

    const intercept = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>(
        '[data-hesap-payment-review="true"]',
      );
      if (!control || !isDashboard()) return;
      event.preventDefault();
      event.stopPropagation();
      router.push(PAYMENT_REVIEW_URL);
    };

    synchronize();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    document.addEventListener("click", intercept, true);
    window.addEventListener("popstate", schedule);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", intercept, true);
      window.removeEventListener("popstate", schedule);
    };
  }, [router]);
  return null;
}
