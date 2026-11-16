import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";

export const runtime = "nodejs";
const input = z.object({ enabled: z.boolean() }).strict();

async function allowMerchant() {
  const session = await requireSession();
  if (!session.tenant_id || !["owner", "manager", "cashier"].includes(session.role ?? ""))
    throw Error("FORBIDDEN");
  return session;
}

export async function GET() {
  try {
    await allowMerchant();
    const { data, error } = await (await supabase()).rpc("merchant_telegram_preference");
    if (error) throw error;
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    const session = await allowMerchant();
    await throttle(request, "merchant-telegram-pref:" + session.user_id, 25);
    const body = input.parse(await limitedJson(request));
    const { data, error } = await (await supabase()).rpc(
      "set_merchant_telegram_preference",
      { p_enabled: body.enabled },
    );
    if (error) throw error;
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}
