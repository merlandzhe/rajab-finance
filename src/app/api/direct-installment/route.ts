import { NextResponse, after } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { deliverAfterCommand } from "@/lib/notification-delivery";

export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"), id: z.uuid(),
    available: z.literal(true), markupBps: z.number().int().min(0).max(10000),
  }).strict(),
  z.object({ action: z.literal("accept"), id: z.uuid(), agreed: z.literal(true) }).strict(),
]);
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await requireSession();
    await throttle(request, "direct-installment:" + session.user_id, 25);
    const payload = schema.parse(await limitedJson(request));
    if (payload.action === "approve" && !["owner", "manager"].includes(session.role ?? "")) throw Error("FORBIDDEN");
    if (payload.action === "accept" && session.role !== "client") throw Error("FORBIDDEN");
    const method = payload.action === "approve"
      ? "approve_direct_installment_with_markup" : "accept_direct_installment";
    const args = payload.action === "approve"
      ? { p_id: payload.id, p_available: true, p_markup_bps: payload.markupBps }
      : { p_id: payload.id, p_confirmed: true };
    const { data, error } = await (await supabase()).rpc(method, args);
    if (error) throw error;
    if (process.env.TELEGRAM_NOTIFICATIONS_ENABLED === "true") after(deliverAfterCommand);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return fail(e); }
}
