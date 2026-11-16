import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Only the signed initData string is accepted. initDataUnsafe, usernames and
// phone numbers are never used as proof of identity.
export function verifyTelegramInitData(
  raw: string,
  botToken: string,
  now = Math.floor(Date.now() / 1000),
) {
  const invalid = () => new Error("TELEGRAM_INVALID");
  if (!botToken || !raw || Buffer.byteLength(raw) > 12000) throw invalid();
  const params = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (seen.has(key) || !/^[a-z_]+$/.test(key) || /[\r\n]/.test(value))
      throw invalid();
    seen.add(key);
  }
  const hash = params.get("hash") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw invalid();
  params.delete("hash");
  // The bot-token HMAC includes signature if Telegram supplies that field.
  params.sort();
  const check = [...params].map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw invalid();
  const date = params.get("auth_date") ?? "";
  if (!/^\d{1,12}$/.test(date)) throw invalid();
  const issued = Number(date);
  if (issued > now + 30 || now - issued > 300)
    throw new Error("TELEGRAM_EXPIRED");
  let user: { id?: number; is_bot?: boolean; username?: string };
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    throw invalid();
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id! <= 0 || user.is_bot)
    throw invalid();
  const start = params.get("start_param") ?? "";
  return {
    telegramId: user.id!,
    username:
      typeof user.username === "string" &&
      /^[A-Za-z0-9_]{1,32}$/.test(user.username)
        ? user.username
        : null,
    // Use the signature, not the raw query ordering, as the replay identifier.
    digest: expected.toString("hex"),
    invite: /^invite_[A-Za-z0-9_-]{43}$/.test(start) ? start.slice(7) : null,
  };
}

export function inviteHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
