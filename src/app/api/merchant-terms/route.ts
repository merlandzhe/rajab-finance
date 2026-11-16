import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, throttle } from "@/lib/http";

export const dynamic = "force-dynamic";
const schema = z.object({
  min_down_bps: z.number().int().min(0).max(9500),
  default_down_bps: z.number().int().min(0).max(9500),
  min_months: z.number().int().min(1).max(36),
  max_months: z.number().int().min(1).max(36),
}).refine(x => x.default_down_bps >= x.min_down_bps && x.max_months >= x.min_months,
  "Проверьте минимальный взнос и сроки");

async function owner() {
  const s = await requireSession();
  if (s.role !== "owner" || !s.tenant_id) throw new Error("FORBIDDEN");
  return s;
}
export async function GET() {
  try {
    await owner();
    const { data, error } = await (await supabase()).rpc("merchant_terms_get");
    if (error) throw error;
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await owner();
    await throttle(req, "merchant-terms:" + s.user_id, 15);
    const body = schema.parse(await req.json());
    const { data, error } = await (await supabase()).rpc("merchant_terms_update", {
      p_min_down_bps: body.min_down_bps,
      p_default_down_bps: body.default_down_bps,
      p_min_months: body.min_months,
      p_max_months: body.max_months,
    });
    if (error) throw error;
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}