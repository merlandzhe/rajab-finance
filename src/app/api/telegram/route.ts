import { NextResponse } from "next/server";
import { validSecret } from "@/lib/telegram-contact";
import { deliverNotifications } from "@/lib/notification-delivery";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: Request) {
  if (
    !validSecret(
      req.headers.get("authorization"),
      process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined,
    )
  )
    return new NextResponse("Unauthorized", { status: 401 });
  try {
    const result = await deliverNotifications(true);
    return NextResponse.json(result, {
      status: result.disabled ? 403 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new NextResponse("Queue unavailable", { status: 503 });
  }
}
