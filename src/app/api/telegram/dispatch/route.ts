import { NextResponse } from "next/server";
import { validSecret } from "@/lib/telegram-contact";
import { deliverNotifications } from "@/lib/notification-delivery";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  if (
    !validSecret(
      req.headers.get("authorization"),
      process.env.NOTIFICATION_WORKER_SECRET
        ? `Bearer ${process.env.NOTIFICATION_WORKER_SECRET}`
        : undefined,
    )
  )
    return new NextResponse("Unauthorized", { status: 401 });
  try {
    return NextResponse.json(await deliverNotifications(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new NextResponse("Queue unavailable", { status: 503 });
  }
}
