import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { telegramMiniAppEnabled } from "./lib/telegram-config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const path = request.nextUrl.pathname;
  if (path.startsWith("/_next/static/") || path.startsWith("/fonts/") ||
      path === "/_next/image" || path === "/favicon.ico") return response;
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite:
              telegramMiniAppEnabled() && process.env.NODE_ENV === "production"
                ? "none"
                : "lax",
            secure: process.env.NODE_ENV === "production",
          }),
        );
      },
    },
  });
  await client.auth.getUser();
  return response;
}
export const config = { matcher: ["/:path*"] };
