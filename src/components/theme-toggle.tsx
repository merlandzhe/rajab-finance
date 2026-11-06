"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const app = window.Telegram?.WebApp;
    const d = app?.initData
      ? app.colorScheme === "dark"
      : localStorage.getItem("rajab-theme") === "dark";
    setDark(d);
    document.documentElement.dataset.theme = d ? "dark" : "light";
    const sync = () =>
      setDark(document.documentElement.dataset.theme === "dark");
    window.addEventListener("rajab-telegram-theme", sync);
    return () => window.removeEventListener("rajab-telegram-theme", sync);
  }, []);
  function toggle() {
    setDark(!dark);
    localStorage.setItem("rajab-theme", !dark ? "dark" : "light");
    document.documentElement.dataset.theme = !dark ? "dark" : "light";
  }
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? "Светлая тема" : "Тёмная тема"}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
