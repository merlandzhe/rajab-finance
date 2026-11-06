export class TelegramDeliveryError extends Error {
  constructor(public code: number, public retryAfter = 0) { super(`Telegram error ${code}`); }
}
export async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
  send: typeof fetch = fetch,
) {
  const result = await send(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, protect_content: true }),
      signal: AbortSignal.timeout(8000),
    },
  );
  const body = await result.json();
  if (!result.ok || body.ok !== true)
    throw new TelegramDeliveryError(Number(body.error_code)||result.status,Number(body.parameters?.retry_after)||0);
  return body.result?.message_id;
}
