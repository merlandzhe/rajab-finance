import { z } from "zod";
export const merchantRequestInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    shop_name: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{9,14}$/),
  })
  .strict();
export const platformInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("status"),
      id: z.uuid(),
      status: z.enum(["review", "rejected"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("issue"),
      id: z.uuid(),
      days: z.number().int().min(1).max(3660),
    })
    .strict(),
  z.object({ action: z.literal("revoke"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("access"),
      tenant_id: z.uuid(),
      status: z.enum(["active", "blocked"]),
      expires_at: z.iso.datetime().nullable(),
    })
    .strict(),
  z.object({ action: z.literal("retry") }).strict(),
  z
    .object({ action: z.literal("revoke_legacy"), tenant_id: z.uuid() })
    .strict(),
]);
export function whatsappUrl(phone?: string) {
  return phone && /^[1-9]\d{9,14}$/.test(phone)
    ? `https://wa.me/${phone}`
    : null;
}
