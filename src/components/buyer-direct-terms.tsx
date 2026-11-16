"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { addMonths, calculate, cents, money, today } from "@/lib/money";
import type { State } from "@/lib/types";

type Quote = ReturnType<typeof calculate>;

/** Buyer quotes only. Contract approval lives on /cabinet/contracts. */
export function BuyerDirectTerms() {
  const pathname = usePathname();
  const [state, setState] = useState<State | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [issue, setIssue] = useState("");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const inCabinet = pathname === "/cabinet";

  useEffect(() => {
    if (!inCabinet) { setState(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/state", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const result = (await response.json()) as State;
        if (!cancelled) setState(result);
      } catch { /* Keep checkout usable if the quote service is unavailable. */ }
    };
    void load();
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, [inCabinet]);

  useEffect(() => {
    if (!inCabinet || !state) return;
    let form: HTMLFormElement | null = null;
    let mount: HTMLElement | null = null;
    const recalc = () => {
      if (!form) return;
      const value = (name: string) => (form!.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
      try {
        if (!state.settings?.[0]) throw Error("Сначала выберите магазин");
        const calculated = calculate({
          cost: cents(value("cost")),
          down: cents(value("down") || "0"),
          months: Number(value("months") || 6),
          firstDate: addMonths(today(), 1),
          pricing: state.settings[0],
        });
        setQuote(calculated);
        setIssue("");
      } catch (e) {
        setQuote(null);
        setIssue((e as Error).message || "Укажите стоимость и срок для расчёта");
      }
    };
    const scan = () => {
      const candidate = document.querySelector<HTMLFormElement>(".buyer-app .application-compose form");
      if (candidate === form) return;
      if (form) { form.removeEventListener("input", recalc); form.removeEventListener("change", recalc); }
      mount?.remove(); mount = null; form = candidate; setSlot(null);
      if (!form) return;
      mount = document.createElement("div");
      mount.className = "hesap-buyer-quote-slot";
      const before = form.querySelector("button[type=submit], button.btn-primary");
      if (before) before.before(mount); else form.append(mount);
      setSlot(mount);
      form.addEventListener("input", recalc);
      form.addEventListener("change", recalc);
      recalc();
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (form) { form.removeEventListener("input", recalc); form.removeEventListener("change", recalc); }
      mount?.remove(); setSlot(null);
    };
  }, [inCabinet, state]);

  if (!inCabinet || !slot) return null;
  return createPortal(
    <div className="hesap-buyer-quote">
      {quote ? <>
        <div><span>Полная стоимость</span><strong>{money(quote.price)}</strong></div>
        <div className="hesap-buyer-quote-primary"><span>Ежемесячно</span><strong>{money(quote.each)}</strong></div>
        <small>Предварительный расчёт по тарифу выбранного магазина. При изменении условий продавцом окончательную цену вы увидите в договоре.</small>
      </> : <p className="hesap-buyer-note">{issue || "Укажите цену товара и срок рассрочки."}</p>}
    </div>, slot,
  );
}
