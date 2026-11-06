import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { fail } from "@/lib/http";
import { isDemo } from "@/lib/demo-db";
import { supabase } from "@/lib/supabase";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const id = z.uuid().parse((await params).id);
    const d = (await getState(s)).documents.find((x) => x.id === id);
    if (!d) return new NextResponse("Документ не найден", { status: 404 });
    let bytes: Uint8Array;
    if (isDemo())
      bytes = await readFile(
        path.join(process.cwd(), ".demo/files", d.storage_path),
      );
    else {
      const { data, error } = await (
        await supabase()
      ).storage
        .from("deal-documents")
        .download(d.storage_path);
      if (error || !data) throw new Error("Download failed");
      bytes = new Uint8Array(await data.arrayBuffer());
    }
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": d.mime_type,
        "Content-Disposition": `attachment; filename="document.${d.mime_type === "application/pdf" ? "pdf" : d.mime_type === "image/png" ? "png" : "jpg"}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
