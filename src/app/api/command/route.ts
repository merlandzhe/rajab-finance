import { NextResponse, after } from "next/server";
import { deliverAfterCommand } from "@/lib/notification-delivery";
import { isDemo } from "@/lib/demo-db";
import { requireSession } from "@/lib/auth";
import { command } from "@/lib/repository";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { commandEnvelope, schemas } from "@/lib/validation";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    await throttle(req, "command:" + s.user_id, 100);
    const body = commandEnvelope.parse(await limitedJson(req));
    let payload: Record<string, unknown> = schemas[body.action].parse(
      body.payload,
    );
    if (body.action.startsWith("portal.") && s.role === "client") {
      payload = { ...payload, expected_tenant: body.tenant_id };
    }
    const result = await command(s, body.action, payload, body.key);
    if (
      !isDemo() &&
      process.env.DEMO_DEPLOYMENT !== "true" &&
      process.env.TELEGRAM_NOTIFICATIONS_ENABLED === "true"
    )
      after(deliverAfterCommand);
    return NextResponse.json(result);
  } catch (e) {
    return fail(e);
  }
}
