import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getState, command } from "@/lib/repository";
import { assertOrigin, fail, throttle } from "@/lib/http";
import { serviceClient } from "@/lib/supabase";
import { validateUpload } from "@/lib/uploads";
import { cleanupUnregisteredFile } from "@/lib/storage-cleanup";
import sharp from "sharp";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    if (!s.tenant_id || !["owner", "manager", "client"].includes(s.role ?? ""))
      throw new Error("FORBIDDEN");
    await throttle(req, "upload:" + s.user_id, 20);
    const len = Number(req.headers.get("content-length"));
    if (!Number.isFinite(len) || len <= 0 || len > 5 * 1024 * 1024 + 20000)
      throw new Error("BODY_TOO_LARGE");
    const form = await req.formData();
    const applicationId = z.uuid().parse(form.get("application_id"));
    const kind = (
      s.role === "client"
        ? z.literal("product_photo")
        : z.literal("purchase_receipt")
    ).parse(form.get("kind"));
    const expectedTenant =
      s.role === "client" ? z.uuid().parse(form.get("tenant_id")) : s.tenant_id;
    if (expectedTenant !== s.tenant_id) throw new Error("FORBIDDEN");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("File required");
    const state = await getState(s);
    if (
      kind === "product_photo" &&
      state.documents.filter(
        (d) => d.application_id === applicationId && d.kind === "product_photo",
      ).length >= 5
    )
      throw new Error("Не более пяти фото на заявку");
    if (
      !state.applications.some(
        (a) =>
          a.id === applicationId &&
          a.tenant_id === s.tenant_id &&
          a.status !== "contracted",
      )
    )
      throw new Error("FORBIDDEN");
    let bytes = new Uint8Array(await file.arrayBuffer());
    let { mime, ext } = await validateUpload(bytes);
    if (kind === "product_photo") {
      if (!mime.startsWith("image/"))
        throw new Error("Фото должно быть JPEG или PNG");
      bytes = new Uint8Array(
        await sharp(bytes)
          .rotate()
          .resize({
            width: 2000,
            height: 2000,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toBuffer(),
      );
      mime = "image/jpeg";
      ext = "jpg";
    }
    const storagePath = `${s.tenant_id}/${applicationId}/${randomUUID()}.${ext}`;
    const { error } = await serviceClient()
      .storage.from("deal-documents")
      .upload(storagePath, bytes, { contentType: mime, upsert: false });
    if (error) throw error;

    let result: unknown;
    try {
      result = await command(
        s,
        kind === "product_photo" ? "portal.photo" : "document.register",
        {
          application_id: applicationId,
          ...(kind === "product_photo"
            ? { id: applicationId, expected_tenant: expectedTenant }
            : {}),
          kind,
          name:
            file.name.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 170) ||
            "Документ",
          storage_path: storagePath,
          mime_type: mime,
          size_bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        randomUUID(),
        );
      } catch (error) {
      // The RPC may have committed before a network error. Verify metadata
      // with the privileged client before attempting to delete an uploaded file.
      const db = serviceClient();
      const cleaned = await cleanupUnregisteredFile(
        async () => {
          const { data, error: queryError } = await db
            .from("documents")
            .select("id")
            .eq("storage_path", storagePath)
            .limit(1);
          if (queryError) throw queryError;
          return (data?.length ?? 0) > 0;
        },
        async () => {
          const { error: removalError } = await db
            .storage.from("deal-documents")
            .remove([storagePath]);
          if (removalError) throw removalError;
        },
      );
      if (!cleaned) {
        // No path or customer information is included in server logs.
        console.warn("HESAP upload metadata failed; file cleanup not confirmed");
      }
      throw error;
    }
    return NextResponse.json(result);
  } catch (e) {
    return fail(e);
  }
}
