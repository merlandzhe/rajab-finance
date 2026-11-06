import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ShieldCheck,
  PackageCheck,
  ArrowRight,
} from "lucide-react";
import { Brand } from "@/components/brand";

import { Calculator } from "@/components/calculator";
import { PublicApplication } from "@/components/public-application";
import { publicPricing } from "@/lib/repository";
import { isDemo } from "@/lib/demo-db";
import MiniPage from "./mini/page";
import { telegramMiniAppEnabled } from "@/lib/telegram-config";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (telegramMiniAppEnabled()) return <MiniPage />;
  const pricing = await publicPricing();
  const demo = isDemo();
  return (
    <>
      <header className="public-nav">
        <Brand />
        <nav className="public-links">
          <a href="#how">Как это работает</a>
          <a href="#calculator">Калькулятор</a>
          <Link href="/murabaha">О мурабахе</Link>

          <Link className="btn btn-outline" href="/login">
            Личный кабинет <ArrowUpRight size={14} />
          </Link>
        </nav>
      </header>
      <main className="public-content">
        <section className="hero">
          <div>
            <p className="eyebrow">Товарная мурабаха</p>
            <h1>
              Важные покупки.
              <br />
              <em>Ясные условия.</em>
            </h1>
            <p>
              Вы выбираете товар. Мы приобретаем его и продаём вам в рассрочку
              по заранее согласованной цене.
            </p>
            <div className="row wrap">
              <a className="btn btn-primary" href="#calculator">
                Рассчитать рассрочку <ArrowUpRight size={16} />
              </a>
              <Link className="btn btn-ghost" href="/murabaha">
                Узнать больше <ArrowRight size={15} />
              </Link>
            </div>
            <div className="hero-foot">
              <span>
                <Check size={13} /> Фиксированная цена
              </span>
              <span>
                <Check size={13} /> Прозрачный график
              </span>
            </div>
          </div>
          <div
            className="hero-art"
            aria-label="Пример сделки: себестоимость 120 000 рублей, прибыль 14 400 рублей, цена 134 400 рублей"
          >
            <div className="art-eyebrow">ДОВЕРИЕ НАЧИНАЕТСЯ С ЯСНОСТИ</div>
            <div className="deal-card">
              <div className="row between">
                <span className="eyebrow" style={{ fontSize: 9 }}>
                  Пример сделки
                </span>
                <PackageCheck size={20} color="#39715a" />
              </div>
              <div className="deal-title">Ваш следующий шаг.</div>
              <div style={{ fontSize: 11, color: "#75877c" }}>
                Согласованная цена товара
              </div>
              <div
                style={{
                  fontSize: 34,
                  letterSpacing: "-.04em",
                  margin: "6px 0 22px",
                }}
              >
                134 400 <span style={{ fontSize: 21 }}>₽</span>
              </div>
              <div className="split">
                <div>
                  <small style={{ color: "#75877c", fontSize: 10 }}>
                    Себестоимость
                  </small>
                  <div style={{ marginTop: 4 }}>120 000 ₽</div>
                </div>
                <div>
                  <small style={{ color: "#75877c", fontSize: 10 }}>
                    Прибыль продавца
                  </small>
                  <div style={{ marginTop: 4 }}>14 400 ₽</div>
                </div>
              </div>
            </div>
            <div className="art-note">
              <ShieldCheck size={28} color="#c9a45c" />
              <div style={{ fontSize: 12 }}>
                Одна цена. Без изменений.<span>На весь срок договора</span>
              </div>
            </div>
          </div>
        </section>
        <section id="how" className="steps">
          {[
            [
              "01",
              "Вы выбираете",
              "Отправьте ссылку на конкретный товар и желаемый срок.",
            ],
            [
              "02",
              "Мы приобретаем",
              "После согласования покупаем товар в собственность.",
            ],
            [
              "03",
              "Фиксируем условия",
              "Согласуем цену продажи и оформляем договор.",
            ],
            [
              "04",
              "Вы пользуетесь",
              "Получаете товар и платите по понятному графику.",
            ],
          ].map(([n, t, p]) => (
            <div className="step" key={n}>
              <div className="step-num">{n}</div>
              <h3>{t}</h3>
              <p>{p}</p>
            </div>
          ))}
        </section>
        <section id="calculator">
          <div className="section-intro">
            <div>
              <p className="eyebrow">Всё прозрачно</p>
              <h2>Посчитаем заранее.</h2>
            </div>
            <p>
              Себестоимость, прибыль продавца и каждый платёж — в одном расчёте.
              Окончательные условия согласуются с продавцом.
            </p>
          </div>
          <Calculator pricing={pricing} />
        </section>
        <section id="application" className="public-bottom">
          <div>
            <p className="eyebrow">От выбора к покупке</p>
            <h2 style={{ fontSize: 35, marginTop: 18 }}>
              Начнём с вашего
              <br />
              товара.
            </h2>
            <p>
              У нас нет каталога. Каждая сделка начинается с вашего запроса:
              нужная техника, мебель или другой конкретный товар.
            </p>
            <p>
              Заявка и предварительное одобрение ещё не означают заключение
              договора.
            </p>
            <div className="hint mt">
              Демонстрационная версия платформы. Договоры и условия требуют
              отдельной юридической и шариатской экспертизы.
            </div>
          </div>
          <PublicApplication
            demo={demo}
            enabled={demo || process.env.ALLOW_REAL_INTAKE === "true"}
          />
        </section>
        <footer className="public-footer">
          <span>© 2026 HESAP · Учёт рассрочки</span>
          <div className="row wrap">
            <Link href="/terms">Условия</Link>
            <Link href="/privacy">Конфиденциальность</Link>
            <Link href="/murabaha">О мурабахе</Link>
          </div>
        </footer>
      </main>
    </>
  );
}
