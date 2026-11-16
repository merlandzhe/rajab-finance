/** Accept a WhatsApp number or a direct-chat link, not arbitrary URLs. */
export function normalizeWhatsappContact(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const digits = (candidate: string): string => {
    const normalized = candidate.replace(/[+\s()\-]/g, "");
    if (!/^[1-9]\d{9,14}$/.test(normalized)) throw Error("INVALID_WHATSAPP");
    return normalized;
  };
  const value = /^(?:www\.)?wa\.me\//i.test(raw) ? "https://" + raw : raw;
  if (!/^https?:\/\//i.test(value)) return digits(value);
  let url: URL;
  try { url = new URL(value); }
  catch { throw Error("INVALID_WHATSAPP"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw Error("INVALID_WHATSAPP");
  }
  const host = url.hostname.toLowerCase();
  if (host === "wa.me" || host === "www.wa.me") {
    const match = /^\/([1-9]\d{9,14})\/?$/.exec(url.pathname);
    if (!match) throw Error("INVALID_WHATSAPP");
    return match[1];
  }
  if (
    (host === "api.whatsapp.com" || host === "web.whatsapp.com") &&
    url.pathname.replace(/\/$/, "") === "/send"
  ) {
    const matches = url.searchParams.getAll("phone");
    if (matches.length !== 1) throw Error("INVALID_WHATSAPP");
    return digits(matches[0]);
  }
  throw Error("INVALID_WHATSAPP");
}
