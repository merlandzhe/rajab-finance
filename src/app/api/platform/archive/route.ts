import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
const input = z
  .object({
    target: z.string().regex(/^(company|user|customer):[0-9a-f-]{36}$/),
    restore: z.boolean(),
    confirm: z.literal(true),
  })
  .strict();
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    if (!s.platform_admin) throw Error("FORBIDDEN");
    await throttle(req, "platform-archive:" + s.user_id, 20);
    const b = input.parse(await limitedJson(req));
    const { error } = await (
      await supabase()
    ).rpc("platform_archive", {
      p_target: b.target,
      p_restore: b.restore,
      p_confirm: b.confirm,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
