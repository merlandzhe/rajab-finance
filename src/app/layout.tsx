import type { Metadata } from "next";
import { Suspense } from "react";
import Script from "next/script";
import { TelegramBridge } from "@/components/telegram-bridge";
import { telegramMiniAppEnabled } from "@/lib/telegram-config";
import "./globals.css";
import "./hesap-design.css";
export const metadata: Metadata = {
  title: {
    default: "HESAP — учёт рассрочки",
    template: "%s · HESAP",
  },
  description:
    "Заявки, договоры и платежи. Личный кабинет покупателя и предпринимателя.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={telegramMiniAppEnabled() ? "hesap mini-app-theme" : "hesap"}
      >
        {telegramMiniAppEnabled() && (
          <>
            <Script
              src="https://telegram.org/js/telegram-web-app.js"
              strategy="beforeInteractive"
            />
            <Suspense fallback={null}>
              <TelegramBridge />
            </Suspense>
          </>
        )}
        {children}
      </body>
    </html>
  );
}
