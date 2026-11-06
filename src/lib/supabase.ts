import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { telegramMiniAppEnabled } from "./telegram-config";
export async function supabase() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error("Сервис временно недоступен: Supabase не настроен");
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) =>
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite:
                telegramMiniAppEnabled() &&
                process.env.NODE_ENV === "production"
                  ? "none"
                  : "lax",
              secure: process.env.NODE_ENV === "production",
            }),
          );
        } catch {
          /* Server Component: refresh happens in proxy/route handler */
        }
      },
    },
  });
}
export function serviceClient() {
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  )
    throw new Error("Не настроены серверные реквизиты Supabase");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
