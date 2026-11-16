import { NextResponse } from "next/server";
import { z } from "zod";
import { assertOrigin, fail, limitedJson } from "@/lib/http";
import { rateLimit } from "@/lib/repository";
import { serviceClient, supabase } from "@/lib/supabase";
import { telegramMiniAppEnabled } from "@/lib/telegram-config";
import { inviteHash, verifyTelegramInitData } from "@/lib/telegram-init";
import { establishTelegramSession } from "@/lib/telegram-session";
import { registerTelegramBuyer } from "@/lib/telegram-registration";
import { configureTelegram } from "@/lib/telegram-setup";
import { session } from "@/lib/auth";

export const runtime = "nodejs";
const input = z
  .object({
    initData: z.string().min(1).max(12000),
    invitation: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
  })
  .strict();
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    if (!telegramMiniAppEnabled()) throw new Error("TELEGRAM_DISABLED");
    const token = process.env.TELEGRAM_MINI_APP_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_NOT_CONFIGURED");
    const { initData, invitation } = input.parse(await limitedJson(req));
    const verified = verifyTelegramInitData(initData, token);
    const invite = invitation ?? verified.invite;
    // The verified Telegram ID also works behind a Russian reverse proxy;
    // do not trust arbitrary forwarded IP headers or share one global bucket.
    if (
      !(await rateLimit(
        inviteHash(`telegram-auth:${verified.telegramId}`),
        15,
        300,
      ))
    )
      throw new Error("RATE_LIMIT");
    const admin = serviceClient();
    // Reuse cookies only when they match this verified Telegram identity.
    const current = await session();
    if (current && !invite) {
      const linked = await admin.rpc("telegram_linked_user", {
        p_id: verified.telegramId,
      });
      if (!linked.error && linked.data === current.user_id) {
        const updated = await admin.rpc("telegram_identity_update", {
          p_id: verified.telegramId,
          p_user: current.user_id,
          p_username: verified.username,
        });
        if (updated.error) throw updated.error;
        return NextResponse.json(
          {
            path: current.platform_admin
              ? "/crm/platform"
              : current.role === "client"
                ? "/cabinet"
                : "/crm",
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    const resolved = await admin.rpc("telegram_exchange", {
      p_telegram_id: verified.telegramId,
      p_digest: verified.digest,
      p_invite_hash: invite ? inviteHash(invite) : null,
    });
    let userId = resolved.data;
    if (resolved.error) {
      const bootstrap =
        !invite && resolved.error.message === "TELEGRAM_INVITE_REQUIRED"
          ? await admin.rpc("telegram_admin_bootstrap", {
              p_telegram_id: verified.telegramId,
            })
          : null;
      const approvedAdmin = !bootstrap?.error && bootstrap?.data === true;
      if (
        resolved.error.message !== "TELEGRAM_INVITE_REQUIRED" ||
        invite ||
        (!approvedAdmin && process.env.TELEGRAM_SELF_SIGNUP_ENABLED !== "true")
      )
        throw resolved.error;
      if (!approvedAdmin && !process.env.TELEGRAM_WEBHOOK_SECRET)
        throw new Error("TELEGRAM_NOT_CONFIGURED");
      if (!approvedAdmin && !(await configureTelegram()).connected)
        throw new Error("TELEGRAM_NOT_CONFIGURED");
      userId = await registerTelegramBuyer(
        admin,
        verified.telegramId,
        verified.digest,
      );
    }
    if (typeof userId !== "string") throw new Error("TELEGRAM_SESSION_FAILED");
    const identity = await admin.rpc("telegram_identity_update", {
      p_id: verified.telegramId,
      p_user: userId,
      p_username: verified.username,
    });
    if (identity.error) throw identity.error;
    // Identity comes exclusively from verified Telegram initData. The database
    // allowlist is operator-provisioned and consumed once; no browser role input.
    const promoted = await admin.rpc("telegram_admin_bootstrap", {
      p_telegram_id: verified.telegramId,
      p_user: userId,
    });
    if (promoted.error) throw promoted.error;
    const path = await establishTelegramSession(
      userId,
      admin,
      await supabase(),
    );
    return NextResponse.json(
      { path },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
