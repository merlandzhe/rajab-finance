import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { assertOrigin, fail, throttle } from "@/lib/http";
import { telegramMiniAppEnabled } from "@/lib/telegram-config";
import { configureTelegram } from "@/lib/telegram-setup";
export const runtime = "nodejs";
export const maxDuration = 60;
async function authorize() {
  const s = await requireSession();
  if (!s.platform_admin) throw new Error("FORBIDDEN");
  if (!telegramMiniAppEnabled()) throw new Error("TELEGRAM_DISABLED");
  return s;
}
export async function GET() {
  try {
    await authorize();
    return NextResponse.json(await configureTelegram(), {headers:{"Cache-Control":"no-store"}});
  } catch(e) { return fail(e); }
}
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await authorize();
    await throttle(req, "telegram-setup:" + s.user_id, 3, 300);
    return NextResponse.json(await configureTelegram(true), {headers:{"Cache-Control":"no-store"}});
  } catch(e) { return fail(e); }
}
