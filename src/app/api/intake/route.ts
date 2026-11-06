import { NextResponse } from "next/server";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { intakeSchema } from "@/lib/validation";
import { demoDb, isDemo } from "@/lib/demo-db";
import { serviceClient } from "@/lib/supabase";
import { TENANT } from "@/lib/demo-ids";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    if (!isDemo() && process.env.ALLOW_REAL_INTAKE !== "true")
      return NextResponse.json(
        { error: "Приём реальных заявок пока закрыт" },
        { status: 403 },
      );
    await throttle(req, "intake", 5, 300);
    const {
      key,
      consent: _,
      website: __,
      ...body
    } = intakeSchema.parse(await limitedJson(req));
    const payload = isDemo()
      ? {
          ...body,
          name: "Демо Посетитель",
          phone: "+7 000 000 00 00",
          email: "demo@example.invalid",
          notes: "Тестовая заявка",
          consent_version: "demo-v1",
        }
      : { ...body, consent_version: "pending-legal-review-v1" };
    if (isDemo()) {
      const db = await demoDb();
      await db.query("select public.public_intake($1,$2::jsonb,$3)", [
        TENANT,
        JSON.stringify(payload),
        key,
      ]);
    } else {
      if (!process.env.PUBLIC_TENANT_ID) throw new Error("Missing tenant");
      const { error } = await serviceClient().rpc("public_intake", {
        p_tenant: process.env.PUBLIC_TENANT_ID,
        p_payload: payload,
        p_key: key,
      });
      if (error) throw error;
    }
    return NextResponse.json({
      ok: true,
      message: isDemo() ? "Тестовая заявка появилась в CRM" : "Заявка принята",
    });
  } catch (e) {
    return fail(e);
  }
}
