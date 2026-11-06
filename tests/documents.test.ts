import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { validateUpload } from "../src/lib/uploads";
import { testReceipt } from "../src/lib/pdf";
import { sendTelegram } from "../src/lib/telegram";
test("PDF upload parsed; HTML/SVG and oversized files rejected", async () => {
  const bytes = await testReceipt("Тестовый товар", "100000");
  assert.equal((await validateUpload(bytes)).mime, "application/pdf");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await assert.rejects(
    validateUpload(Buffer.from('<svg onload="alert(1)"></svg>')),
  );
  await assert.rejects(validateUpload(new Uint8Array(6 * 1024 * 1024)));
  await assert.rejects(validateUpload(Buffer.from("%PDF-not-a-real-document")));
});
test("Telegram requests contain minimal text, no token in body; non-ok rejected", async () => {
  let captured = "";
  await sendTelegram(
    "test-token",
    "123",
    "Новая заявка #123. Откройте CRM.",
    (async (_url, init) => {
      captured = String(init?.body);
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 1 } }),
        { status: 200 },
      );
    }) as typeof fetch,
  );
  assert.ok(!captured.includes("test-token"));
  assert.ok(captured.includes("protect_content"));
  await assert.rejects(
    sendTelegram(
      "x",
      "y",
      "z",
      (async () =>
        new Response('{"ok":false}', { status: 200 })) as typeof fetch,
    ),
  );
});
test("forged PNG magic and active PDF are rejected", async () => {
  await assert.rejects(
    validateUpload(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])),
  );
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const { PDFName, PDFString } = await import("pdf-lib");
  pdf.catalog.set(
    PDFName.of("OpenAction"),
    pdf.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFString.of("app.alert(1)"),
    }),
  );
  await assert.rejects(validateUpload(await pdf.save()), /содержимое/);
});
