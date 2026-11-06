import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isDemo, demoRpc, demoDb } from "@/lib/demo-db";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { getState } from "@/lib/repository";
import { payableContracts } from "@/lib/payment-eligibility";
const input = z
  .object({
    sbp_phone: z.string().regex(/^(?:\+7\d{10})?$/),
    bank_name: z.string().trim().max(120),
    recipient_name: z.string().trim().max(120),
    cash_enabled: z.boolean(),
    cash_instructions: z.string().trim().max(500),
  })
  .strict()
  .refine(
    (x) =>
      !x.sbp_phone || (x.bank_name.length >= 2 && x.recipient_name.length >= 2),
  );
export async function GET() {
  try {
    const s = await requireSession();
    if (!s.tenant_id) throw new Error("FORBIDDEN");
    if (
      s.role === "client" &&
      !payableContracts(await getState(s), s.tenant_id).length
    )
      return NextResponse.json(null, {
        headers: { "Cache-Control": "no-store" },
      });
    if (isDemo()) {
      const db = await demoDb();
      const r = await db.query(
        "select * from public.seller_payment_methods where tenant_id=$1",
        [s.tenant_id],
      );
      return NextResponse.json(r.rows[0] ?? null, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const { data, error } = await (
      await supabase()
    )
      .from("seller_payment_methods")
      .select("*")
      .eq("tenant_id", s.tenant_id)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    if (s.role !== "owner") throw new Error("FORBIDDEN");
    await throttle(req, "payment-methods:" + s.user_id, 20);
    const b = input.parse(await limitedJson(req));
    const args = {
      p_phone: b.sbp_phone,
      p_bank: b.bank_name,
      p_recipient: b.recipient_name,
      p_cash: b.cash_enabled,
      p_instructions: b.cash_instructions,
    };
    if (isDemo())
      await demoRpc(
        s.user_id,
        "save_seller_payment_methods",
        Object.values(args),
      );
    else {
      const { error } = await (
        await supabase()
      ).rpc("save_seller_payment_methods", args);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
