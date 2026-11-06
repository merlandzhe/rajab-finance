// The two verified public domains of the same HESAP production project
// may be used while the Telegram Mini App is being migrated.
// This allowlist must never be constructed from user-controlled Host headers.
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configured = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const allowed = new Set([new URL(configured).origin]);
  if (process.env.VERCEL) {
    allowed.add("https://hesap-mini-app.vercel.app");
    allowed.add("https://rajab-finance-mini.vercel.app");
  }
  if (!origin || !allowed.has(origin)) throw new Error("INVALID_ORIGIN");
}
