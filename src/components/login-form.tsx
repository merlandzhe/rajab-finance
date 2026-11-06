"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(body: unknown, path = "/crm") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      router.push(path);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-form">
      <h2>Вход в кабинет</h2>
      <p className="muted" style={{ fontSize: 12, margin: "12px 0 25px" }}>
        Используйте учётную запись, созданную владельцем организации.
      </p>
      <form onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void login({ action: "login", email: f.get("email"), password: f.get("password") }, "/crm");
      }}>
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field">
          Пароль
          <input name="password" type="password" minLength={8} autoComplete="current-password" required />
        </label>
        <Button disabled={busy} className="full">Войти <ArrowRight size={15} /></Button>
      </form>
      {error && <p className="error mt" role="alert">{error}</p>}
      <p className="row muted mt" style={{ fontSize: 11 }}>
        <ShieldCheck size={15} /> Доступ ограничен вашей организацией
      </p>
    </div>
  );
}
