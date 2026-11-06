import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function validSecret(
  actual: string | null,
  expected: string | undefined,
) {
  return (
    !!actual &&
    !!expected &&
    Buffer.byteLength(actual) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
const telegramId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const message = z.object({
  date: z.number().int(),
  from: z.object({ id: telegramId, is_bot: z.boolean().optional() }),
  chat: z.object({ id: telegramId, type: z.literal("private") }),
  contact: z.object({ user_id: telegramId, phone_number: z.string().max(32) }),
});
export function verifiedContact(
  update: unknown,
  now = Math.floor(Date.now() / 1000),
) {
  const parsed = z
    .object({ update_id: z.number().int().nonnegative(), message })
    .safeParse(update);
  if (!parsed.success) return null;
  const { message: m, update_id } = parsed.data;
  if (
    m.from.is_bot ||
    m.from.id !== m.chat.id ||
    m.from.id !== m.contact.user_id ||
    m.date > now + 30 ||
    now - m.date > 900
  )
    return null;
  const phone = "+" + m.contact.phone_number.replace(/^\+/, "");
  if (!/^\+7\d{10}$/.test(phone)) return null;
  return { telegramId: m.from.id, phone, date: m.date, updateId: update_id };
}
