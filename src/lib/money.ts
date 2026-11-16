import Decimal from "decimal.js";
export type Pricing = {
  mode: "fixed" | "term" | "individual";
  fixed_bps: number;
  term_rates: Record<string, number>;
  version: number;
};
export const DEMO_PRICING: Pricing = {
  mode: "term",
  fixed_bps: 1800,
  term_rates: { "3": 600, "6": 1200, "9": 1800, "12": 2400 },
  version: 1,
};
export function cents(value: string): string {
  if (!/^\d{1,10}([.,]\d{1,2})?$/.test(value))
    throw new Error("Введите сумму с точностью до копейки");
  return new Decimal(value.replace(",", ".")).mul(100).toFixed(0);
}
export function rubles(value: Decimal.Value): string {
  return new Decimal(value).div(100).toFixed(2);
}
export function money(value: Decimal.Value, compact = false): string {
  const n = new Decimal(value).div(100);
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  }).format(n.toNumber());
}
export function sum(values: Decimal.Value[]): string {
  return values.reduce<Decimal>((a, v) => a.plus(v), new Decimal(0)).toFixed(0);
}
export function diff(a: Decimal.Value, b: Decimal.Value): string {
  return new Decimal(a).minus(b).toFixed(0);
}
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function addMonths(date: string, offset: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
export function calculate(input: {
  cost: string;
  down: string;
  months: number;
  firstDate: string;
  pricing: Pricing;
  customKind?: "rubles" | "percent";
  customValue?: string;
}) {
  const { cost, down, months, pricing, firstDate } = input;
  if (
    !/^\d+$/.test(cost) ||
    !/^\d+$/.test(down) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 36
  )
    throw new Error("Некорректные условия");
  const base = new Decimal(cost);
  if (base.lte(0) || base.gt(100000000000))
    throw new Error("Стоимость вне диапазона");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(firstDate) ||
    Number.isNaN(new Date(firstDate + "T00:00:00Z").getTime()) ||
    new Date(firstDate + "T00:00:00Z").toISOString().slice(0, 10) !== firstDate
  )
    throw new Error("Проверьте дату");
  let rate: number | undefined;
  let profit: Decimal | undefined;
  if (pricing.mode === "fixed") rate = pricing.fixed_bps;
  if (pricing.mode === "term") rate = pricing.term_rates[String(months)];
  if (pricing.mode === "individual") {
    if (
      !input.customKind ||
      !input.customValue ||
      !/^\d+$/.test(input.customValue)
    )
      throw new Error("Укажите индивидуальную прибыль");
    if (input.customKind === "rubles") profit = new Decimal(input.customValue);
    else rate = Number(input.customValue);
  }
  if (rate !== undefined) {
    if (!Number.isInteger(rate) || rate < 0 || rate > 100000)
      throw new Error("Наценка вне диапазона");
    profit = base
      .mul(rate)
      .div(10000)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  } else if (pricing.mode !== "individual")
    throw new Error("Для этого срока тариф не задан");
  if (profit === undefined || profit!.lt(0) || profit!.gt(100000000000))
    throw new Error("Некорректная прибыль");
  const price = base.plus(profit!);
  const rest = price.minus(down);
  if (rest.lt(0)) throw new Error("Взнос превышает цену продажи");
  const each = rest.div(months).floor();
  const schedule = Array.from({ length: months }, (_, i) => ({
    sequence: i + 1,
    due_on: addMonths(firstDate, i),
    amount: (i === months - 1
      ? rest.minus(each.mul(months - 1))
      : each
    ).toFixed(0),
  }));
  return {
    cost,
    profit: profit!.toFixed(0),
    price: price.toFixed(0),
    down,
    remaining: rest.toFixed(0),
    each: each.toFixed(0),
    schedule,
  };
}
