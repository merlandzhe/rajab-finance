import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { telegramMiniAppEnabled } from "./lib/telegram-config";
export async function proxy(request: NextRequest) {
  // The hosted demo is closed by default, including public pages and assets.
  if (process.env.DEMO_DEPLOYMENT === "true") {
    const password = process.env.DEMO_ACCESS_PASSWORD;
    if (!password || password.length < 20)
      return new NextResponse("Демоверсия настраивается", { status: 503 });
    const expected =
      "Basic " + Buffer.from("demo:" + password).toString("base64");
    const actual = request.headers.get("authorization") ?? "";
    if (
      !timingSafeEqual(
        createHash("sha256").update(expected).digest(),
        createHash("sha256").update(actual).digest(),
      )
    )
      return new NextResponse("Введите пароль демоверсии", {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Basic realm="RAJAB FINANCE DEMO", charset="UTF-8"',
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
  }
  let response = NextResponse.next({ request });
  if (process.env.DEMO_MODE === "true" && !process.env.VERCEL) return response;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
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
export const config = {
  matcher: ["/:path*"],
};
