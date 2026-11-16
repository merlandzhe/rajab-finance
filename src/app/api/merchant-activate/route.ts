import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { inviteHash } from "@/lib/telegram-init";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    await throttle(req, "activate:" + s.user_id, 8, 300);
    const b = z
      .object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(await limitedJson(req));
    const { error } = await (
      await supabase()
    ).rpc("merchant_activate", { p_hash: inviteHash(b.code) });
    if (error) throw error;
    return NextResponse.json(
      { path: "/crm" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
