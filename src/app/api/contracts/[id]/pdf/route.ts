import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { fail } from "@/lib/http";
import { contractPdf } from "@/lib/pdf";
export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const id = z.uuid().parse((await params).id);
    const data = await getState(s);
    const c = data.contracts.find((c) => c.id === id);
    if (!c) return new NextResponse("Договор не найден", { status: 404 });
    const bytes = await contractPdf(data, c);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${c.number}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
