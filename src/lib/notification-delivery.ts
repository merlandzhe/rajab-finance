import "server-only";
import { serviceClient } from "./supabase";
import { sendTelegram, TelegramDeliveryError } from "./telegram";

export async function deliverNotifications(reminders = false) {
  if (process.env.TELEGRAM_NOTIFICATIONS_ENABLED !== "true")
    return { sent: 0, failed: 0, disabled: true };
  const token = process.env.TELEGRAM_MINI_APP_BOT_TOKEN;
  if (!token) throw new Error("Telegram not configured");
  const db = serviceClient();
  if (reminders) {
    const r = await db.rpc("queue_buyer_reminders");
    if (r.error) throw new Error("Queue unavailable");
  }
  const { data, error } = await db.rpc("claim_buyer_notifications");
  if (error) throw new Error("Queue unavailable");
  let sent = 0,
    failed = 0;
  await Promise.all(
    (data ?? []).map(
      async (n: {
        id: string;
        telegram_id: number | string;
        message: string;
        lease: string;
      }) => {
        let success = false;
        let failure = "network",
          retryAfter = 0;
        try {
          await sendTelegram(token, String(n.telegram_id), n.message);
          success = true;
        } catch (e) {
          if (e instanceof TelegramDeliveryError) {
            failure = String(e.code);
            retryAfter = e.retryAfter;
          }
        }
        const saved = await db.rpc("finish_delivery", {
          p_id: n.id,
          p_lease: n.lease,
          p_success: success,
          p_error: failure,
          p_retry: retryAfter,
        });
        if (saved.error) throw new Error("Queue unavailable");
        if (success) sent++;
        else failed++;
      },
    ),
  );
  return { sent, failed, disabled: false };
}

export async function deliverAfterCommand() {
  try {
    await deliverNotifications();
  } catch {
    console.warn("Telegram queue delivery deferred");
  }
}
