"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Inset = { top: number; bottom: number; left: number; right: number };
export type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  ready(): void;
  expand(): void;
  requestContact?(callback?: (shared: boolean) => void): void;
  requestWriteAccess?(callback?: (allowed: boolean) => void): void;
  onEvent(name: string, listener: () => void): void;
  offEvent(name: string, listener: () => void): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(fn: () => void): void;
    offClick(fn: () => void): void;
  };
};
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
export function TelegramBridge() {
  const path = usePathname();
  const search = useSearchParams();
  const view = search.get("view");
  const router = useRouter();
  useEffect(() => {
    const app = window.Telegram?.WebApp;
    if (!app?.initData) return;
    const root = document.documentElement;
    root.dataset.telegram = "true";
    const applyInsets = () => {
      for (const edge of ["top", "bottom", "left", "right"] as const) {
        const inset =
          (app.safeAreaInset?.[edge] ?? 0) +
          (app.contentSafeAreaInset?.[edge] ?? 0);
        root.style.setProperty(`--telegram-${edge}`, `${Math.max(0, inset)}px`);
      }
    };
    const theme = () => {
      root.dataset.theme = "dark";
      app.setHeaderColor?.("#0d202e");
      app.setBackgroundColor?.("#0d202e");
      app.setBottomBarColor?.("#0d202e");
      window.dispatchEvent(new Event("rajab-telegram-theme"));
    };
    applyInsets();
    theme();
    app.ready();
    app.expand();
    app.onEvent("safeAreaChanged", applyInsets);
    app.onEvent("contentSafeAreaChanged", applyInsets);
    app.onEvent("themeChanged", theme);
    return () => {
      app.offEvent("safeAreaChanged", applyInsets);
      app.offEvent("contentSafeAreaChanged", applyInsets);
      app.offEvent("themeChanged", theme);
    };
  }, []);
  useEffect(() => {
    const app = window.Telegram?.WebApp;
    if (!app?.initData) return;
    const root =
      ["/mini", "/cabinet", "/crm", "/crm/platform", "/login"].includes(path) &&
      !(path === "/cabinet" && view && view !== "home");
    if (root) app.BackButton.hide();
    else app.BackButton.show();
    const back = () => router.back();
    app.BackButton.onClick(back);
    return () => app.BackButton.offClick(back);
  }, [path, view, router]);
  return null;
}
