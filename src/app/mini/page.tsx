import { Brand } from "@/components/brand";
import { TelegramEntry } from "@/components/telegram-entry";
import {
  telegramBotUsername,
  telegramMiniAppEnabled,
} from "@/lib/telegram-config";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <main className="mini-page">
      <Brand />
      {telegramMiniAppEnabled() ? (
        <TelegramEntry bot={telegramBotUsername()} />
      ) : (
        <section className="card mini-entry">
          <span className="eyebrow">HESAP</span>
          <h1>Telegram-приложение готовится к запуску</h1>
          <p className="muted">
            Вход появится после подключения отдельного бота.
          </p>
        </section>
      )}
    </main>
  );
}
