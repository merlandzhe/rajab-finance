import { NextResponse, after } from "next/server";
import { limitedJson } from "@/lib/http";
import { serviceClient } from "@/lib/supabase";
import { validSecret, verifiedContact } from "@/lib/telegram-contact";
import {
  telegramMiniAppEnabled,
  telegramBotUsername,
} from "@/lib/telegram-config";
import { deliverAfterCommand } from "@/lib/notification-delivery";
import { sendTelegram } from "@/lib/telegram";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (
    !telegramMiniAppEnabled() ||
    !validSecret(
      req.headers.get("x-telegram-bot-api-secret-token"),
      process.env.TELEGRAM_WEBHOOK_SECRET,
    )
  )
    return new NextResponse("Unauthorized", { status: 401 });
  try {
    const update = await limitedJson(req);
    const contact = verifiedContact(update);
    if (contact) {
      const { error } = await serviceClient().rpc("telegram_verify_phone", {
        p_telegram_id: contact.telegramId,
        p_phone: contact.phone,
        p_message_date: contact.date,
        p_update_id: contact.updateId,
      });
      if (error) return new NextResponse("Retry later", { status: 503 });
    }
    const start = z
      .object({
        message: z.object({
          date: z.number(),
          text: z.string(),
          from: z.object({
            id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            is_bot: z.boolean().optional(),
          }),
          chat: z.object({
            id: z.number().int().positive(),
            type: z.literal("private"),
          }),
        }),
      })
      .safeParse(update);
    if (start.success) {
      const m = start.data.message;
      if (
        !m.from.is_bot &&
        m.from.id === m.chat.id &&
        /^\/start(?:\s|$)/.test(m.text) &&
        Math.abs(Date.now() / 1000 - m.date) < 900
      ) {
        const { error } = await serviceClient().rpc("telegram_bot_started", {
          p_id: m.from.id,
        });
        if (error) return new NextResponse("Retry later", { status: 503 });
        after(async () => {
          try {
            await sendTelegram(
              process.env.TELEGRAM_MINI_APP_BOT_TOKEN!,
              String(m.from.id),
              `Добро пожаловать в HESAP! Откройте приложение: https://t.me/${telegramBotUsername()}?startapp\nПокупателям — заявки и платежи. Предпринимателям — подключение своего магазина.`,
            );
          } catch {}
          await deliverAfterCommand();
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch {
    return new NextResponse("Invalid update", { status: 400 });
  }
}
