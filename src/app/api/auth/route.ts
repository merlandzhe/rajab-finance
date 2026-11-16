import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { demoLogin } from "@/lib/auth";
import { isDemo } from "@/lib/demo-db";
import { supabase } from "@/lib/supabase";
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("demo"),
      role: z.enum([
        "owner",
        "manager",
        "cashier",
        "client",
        "buyer",
        "other",
        "platform",
      ]),
    })
    .strict(),
  z
    .object({
      action: z.literal("login"),
      email: z.email(),
      password: z.string().min(8).max(200),
    })
    .strict(),
  z.object({ action: z.literal("logout") }).strict(),
]);
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    await throttle(req, "auth", 20, 300);
    const data = input.parse(await limitedJson(req));
    if (data.action === "demo") {
      if (!isDemo()) throw new Error("FORBIDDEN");
      await demoLogin(data.role);
    }
    if (data.action === "login") {
      const { error } = await (
        await supabase()
      ).auth.signInWithPassword({ email: data.email, password: data.password });
      if (error)
        return NextResponse.json(
          { error: "Не удалось войти. Проверьте email и пароль." },
          { status: 401 },
        );
    }
    if (data.action === "logout") {
      (await cookies()).delete("rajab_demo");
      if (!isDemo()) await (await supabase()).auth.signOut();
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
