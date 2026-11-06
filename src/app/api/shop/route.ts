import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, throttle } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    if (s.role !== "owner" || !s.tenant_id) throw Error("FORBIDDEN");
    await throttle(req, "shop:" + s.user_id, 10);
    const size = Number(req.headers.get("content-length"));
    if (!size || size > 2 * 1024 * 1024 + 20000) throw Error("BODY_TOO_LARGE");
    const f = await req.formData();
    const name = z.string().trim().min(2).max(120).parse(f.get("name"));
    const phone = z
      .string()
      .regex(/^(?:[1-9]\d{9,14})?$/)
      .parse(String(f.get("whatsapp") ?? "").replace(/[+\s()-]/g, ""));
    const db = await supabase();
    const { data: old, error } = await db
      .from("seller_directory")
      .select("logo_data")
      .eq("tenant_id", s.tenant_id)
      .maybeSingle();
    if (error) throw error;
    let logo = f.get("remove_logo") === "on" ? "" : (old?.logo_data ?? "");
    const image = f.get("logo");
    if (image instanceof File && image.size) {
      if (image.size > 2 * 1024 * 1024) throw Error("BODY_TOO_LARGE");
      const bytes = Buffer.from(await image.arrayBuffer());
      const decoder = sharp(bytes, { limitInputPixels: 16000000 });
      const meta = await decoder.metadata();
      if (
        !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
        (meta.pages ?? 1) > 1
      )
        throw Error("Формат логотипа: PNG, JPEG или WebP");
      const encoded = await decoder
        .rotate()
        .resize(192, 192, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      logo = "data:image/webp;base64," + encoded.toString("base64");
      if (logo.length > 120000) throw Error("Логотип слишком большой");
    }
    const saved = await db.rpc("save_shop", {
      p_name: name,
      p_whatsapp: phone,
      p_logo: logo,
      p_enabled: f.get("enabled") === "on",
    });
    if (saved.error) throw saved.error;
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
