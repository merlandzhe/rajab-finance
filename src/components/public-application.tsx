"use client";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { cents } from "@/lib/money";
import { Button } from "./ui/button";
export function PublicApplication({
  demo,
  enabled,
}: {
  demo: boolean;
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [key, setKey] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const operationKey = key || crypto.randomUUID();
      setKey(operationKey);
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: demo ? "Демо Посетитель" : f.get("name"),
          phone: demo ? "+7 000 000 00 00" : f.get("phone"),
          product_name: f.get("product_name"),
          product_url: f.get("product_url"),
          supplier: "",
          estimated_cost: cents(String(f.get("cost"))),
          down_payment: "0",
          months: 6,
          notes: "",
          consent: f.get("consent") === "on",
          website: f.get("website"),
          key: operationKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(data.message);
      setKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!enabled)
    return (
      <div className="hint">
        Приём реальных заявок откроется после согласования правовых требований.
        Пока можно изучить калькулятор.
      </div>
    );
  if (message)
    return (
      <div className="success" role="status">
        <h3>Заявка создана</h3>
        <p style={{ marginTop: 12 }}>{message}</p>
        <a className="btn btn-primary mt" href="/login">
          Открыть CRM
        </a>
      </div>
    );
  return (
    <form onSubmit={submit}>
      {demo ? (
        <div className="hint mb">
          Демонстрация: вместо личных сведений используется «Демо Посетитель».
          Не указывайте реальные персональные данные.
        </div>
      ) : (
        <div className="grid2">
          <label className="field">
            Ваше имя
            <input name="name" required maxLength={120} />
          </label>
          <label className="field">
            Телефон
            <input name="phone" type="tel" required />
          </label>
        </div>
      )}
      <label className="field">
        Какой товар хотите приобрести?
        <input
          name="product_name"
          placeholder="Например, ноутбук для работы"
          required
          minLength={2}
          maxLength={160}
        />
      </label>
      <label className="field">
        Ссылка на товар
        <input name="product_url" type="url" placeholder="https://…" />
      </label>
      <label className="field">
        Предполагаемая стоимость, ₽
        <input name="cost" inputMode="decimal" defaultValue="120000" required />
      </label>
      <div hidden aria-hidden="true">
        <label>
          Ваш сайт
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="check">
        <input name="consent" type="checkbox" required />
        <span>
          {demo
            ? "Понимаю, что заявка тестовая. Реальные личные сведения не передаю."
            : "Согласен с политикой обработки персональных данных."}
        </span>
      </label>
      {error && (
        <p className="error mb" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy} className="full">
        {busy
          ? "Отправляем…"
          : demo
            ? "Создать тестовую заявку"
            : "Отправить заявку"}
        <ArrowUpRight size={16} />
      </Button>
    </form>
  );
}
