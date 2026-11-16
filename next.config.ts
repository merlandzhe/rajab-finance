import type { NextConfig } from "next";
import { telegramMiniAppEnabled } from "./src/lib/telegram-config";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    const telegram = telegramMiniAppEnabled();
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(!telegram ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${telegram ? " https://telegram.org/js/telegram-web-app.js" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors ${telegram ? "https://web.telegram.org" : "'none'"}; base-uri 'self'; form-action 'self'; object-src 'none'`,
          },
        ],
      },
    ];
  },
};
export default config;
