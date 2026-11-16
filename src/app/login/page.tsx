import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { isDemo } from "@/lib/demo-db";

import {
  telegramBotUsername,
  telegramMiniAppEnabled,
} from "@/lib/telegram-config";
export const dynamic = "force-dynamic";
export default function Page() {
  if (telegramMiniAppEnabled()) redirect("/mini");
  return (
    <>
      <header className="public-nav">
        <Brand />

      </header>
      <main className="card login">
        <div className="login-intro">
          <p className="eyebrow">Рабочее пространство</p>
          <h1>
            Каждая сделка.
            <br />
            Под контролем.
          </h1>
          <p>
            От первого запроса до последнего платежа — в одном пространстве
            HESAP.
          </p>
          <span style={{ fontSize: 10, color: "#b4ccbd" }}>
            Прозрачность в деталях.
          </span>
        </div>
        <LoginForm demo={isDemo()} />
      </main>
      {telegramMiniAppEnabled() && telegramBotUsername() && (
        <p style={{ textAlign: "center", padding: "0 20px 30px" }}>
          <a
            href={`https://t.me/${telegramBotUsername()}?startapp`}
            rel="noreferrer"
          >
            Открыть кабинет в Telegram
          </a>
        </p>
      )}
    </>
  );
}
