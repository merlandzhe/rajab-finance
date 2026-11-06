import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRef,
  type PDFObject,
} from "pdf-lib";
import sharp from "sharp";
export async function validateUpload(bytes: Uint8Array) {
  if (bytes.byteLength < 8 || bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Размер файла должен быть от 8 байт до 5 МБ");
  const b = Buffer.from(bytes);
  if (b.subarray(0, 5).toString() === "%PDF-") {
    const pdf = await PDFDocument.load(b, { ignoreEncryption: false });
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100)
      throw new Error("PDF должен содержать от 1 до 100 страниц");
    const forbidden = new Set([
      "JavaScript",
      "JS",
      "OpenAction",
      "AA",
      "Launch",
      "EmbeddedFiles",
      "EmbeddedFile",
      "RichMedia",
      "XFA",
      "AcroForm",
    ]);
    const seen = new Set<PDFObject>();
    function inspect(obj: PDFObject) {
      if (obj instanceof PDFRef || seen.has(obj)) return;
      seen.add(obj);
      if (obj instanceof PDFName && forbidden.has(obj.decodeText()))
        throw new Error("Активное содержимое PDF запрещено");
      if (obj instanceof PDFDict) {
        for (const [key, value] of obj.entries()) {
          if (forbidden.has(key.decodeText()))
            throw new Error("Активное содержимое PDF запрещено");
          inspect(value);
        }
      }
      if (obj instanceof PDFArray) {
        for (const value of obj.asArray()) inspect(value);
      }
    }
    for (const [, object] of pdf.context.enumerateIndirectObjects())
      inspect(object);
    return { mime: "application/pdf", ext: "pdf" };
  }
  let mime = "",
    ext = "";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = "image/png";
    ext = "png";
  }
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) {
    mime = "image/jpeg";
    ext = "jpg";
  }
  if (mime) {
    const decoder = sharp(b, { limitInputPixels: 25000000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
      throw new Error("Некорректное изображение");
    await decoder.raw().toBuffer();
    return { mime, ext };
  }
  throw new Error("Разрешены только PDF, PNG и JPEG");
}
