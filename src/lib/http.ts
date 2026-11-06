import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createHash } from "node:crypto";
import { rateLimit } from "./repository";
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN ?? "http://localhost:3000";
  if (!origin || origin !== new URL(expected).origin)
    throw new Error("INVALID_ORIGIN");
}
export async function limitedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 20000) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function throttle(
  request: Request,
  scope: string,
  limit: number,
  seconds = 60,
) {
  // Vercel supplies x-vercel-forwarded-for; a client-supplied forwarded header is never trusted on other hosts.
  const ip = process.env.VERCEL
    ? (request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown")
    : "local";
  const key = createHash("sha256")
    .update(scope + ":" + ip)
    .digest("hex");
  if (!(await rateLimit(key, limit, seconds))) throw new Error("RATE_LIMIT");
}
export function fail(e: unknown) {
  const error = e as { message?: string; code?: string };
  const map: Record<string, [number, string]> = {
    AUTH_REQUIRED: [401, "Войдите в систему"],
    FORBIDDEN: [403, "Недостаточно прав"],
    INVALID_ORIGIN: [403, "Недопустимый источник запроса"],
    RATE_LIMIT: [429, "Слишком много запросов. Попробуйте позже."],
    BODY_TOO_LARGE: [413, "Слишком большой запрос"],
    TELEGRAM_DISABLED: [403, "Вход через Telegram пока не включён."],
    TELEGRAM_NOT_CONFIGURED: [503, "Подключение Telegram ещё настраивается."],
    TELEGRAM_WEBHOOK_CONFLICT: [409, "Бот подключён к другому адресу. Настройки не изменены — обратитесь к администратору."],
    TELEGRAM_INVALID: [
      401,
      "Не удалось проверить Telegram. Откройте приложение через бота HESAP.",
    ],
    TELEGRAM_EXPIRED: [
      401,
      "Время входа истекло. Закройте приложение и откройте его снова в Telegram.",
    ],
    TELEGRAM_REPLAY: [
      401,
      "Этот вход уже использован. Закройте приложение и откройте его снова.",
    ],
    TELEGRAM_INVITE_REQUIRED: [
      403,
      "Для первого входа нужна персональная ссылка. Попросите её у владельца вашего кабинета.",
    ],
    TELEGRAM_INVITE_INVALID: [
      403,
      "Приглашение недействительно или уже использовано. Попросите новую ссылку.",
    ],
    TELEGRAM_ALREADY_LINKED: [
      409,
      "Telegram уже подключён к этому кабинету. Вход доступен через кнопку приложения у бота.",
    ],
    TELEGRAM_ACCOUNT_REQUIRED: [
      400,
      "Сначала нужно создать учётную запись клиента и связать её с этой карточкой.",
    ],
    TELEGRAM_SESSION_FAILED: [
      503,
      "Не удалось завершить вход. Закройте приложение и откройте его снова; если ошибка повторится, сообщите владельцу.",
    ],
  };
  const [status, message] =
    map[error.message ?? ""] ??
    (e instanceof ZodError
      ? [400, "Проверьте обязательные поля и формат данных"]
      : error.code === "42501"
        ? [403, "Недостаточно прав"]
        : error.code === "P0001"
          ? [400, error.message ?? "Операция отклонена"]
          : [
              400,
              "Не удалось выполнить операцию. Проверьте данные и настройки.",
            ]);
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
