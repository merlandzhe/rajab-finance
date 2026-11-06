import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { assertOrigin, fail, limitedJson } from "@/lib/http";
import { rateLimit } from "@/lib/repository";
import { supabase } from "@/lib/supabase";
import {
  telegramBotUsername,
  telegramMiniAppEnabled,
} from "@/lib/telegram-config";
import { inviteHash } from "@/lib/telegram-init";

const input = z
  .object({ customer_id: z.uuid().optional(), cancel: z.boolean().optional() })
  .strict();
export async function GET() {
  try {
    await requireSession();
    const {data,error}=await (await supabase()).rpc("notification_health");
    if(error) throw error;
    return NextResponse.json({linked:data?.linked===true},{headers:{"Cache-Control":"no-store"}});
  } catch(e){return fail(e);}
}
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    if (!telegramMiniAppEnabled()) throw new Error("TELEGRAM_DISABLED");
    const s = await requireSession();
    const data = input.parse(await limitedJson(req));
    if (data.customer_id && s.role !== "owner") throw new Error("FORBIDDEN");
    const bot = telegramBotUsername();
    if (!bot || !process.env.TELEGRAM_MINI_APP_BOT_TOKEN)
      throw new Error("TELEGRAM_NOT_CONFIGURED");
    if (!(await rateLimit(inviteHash(`telegram-invite:${s.user_id}`), 20, 300)))
      throw new Error("RATE_LIMIT");
    const client = await supabase();
    if (data.cancel) {
      const result = await client.rpc("telegram_cancel_invite", {
        p_customer: data.customer_id ?? null,
      });
      if (result.error) throw result.error;
      return NextResponse.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const token = randomBytes(32).toString("base64url");
    const result = await client.rpc("telegram_invite", {
      p_token_hash: inviteHash(token),
      p_customer: data.customer_id ?? null,
    });
    if (result.error) throw result.error;
    return NextResponse.json(
      {
        code: token,
        url: `https://t.me/${bot}?startapp=invite_${token}`,
        expires_at: result.data.expires_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
