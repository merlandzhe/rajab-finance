import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { fail } from "@/lib/http";
export async function GET() {
  try {
    return NextResponse.json(await getState(await requireSession()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
