// LOCAL ONLY. First build with DEMO_MODE=true APP_ORIGIN=http://127.0.0.1:3100.
// Browser → API → local demo database; no hosted writes or messages.
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
const base = "http://127.0.0.1:3100";
const output = process.env.REVIEW_OUTPUT || "/tmp/hesap-finance-review";
await mkdir(output, { recursive: true });
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    env: {
      ...process.env,
      DEMO_MODE: "true",
      APP_ORIGIN: base,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
});
const bundled = process.env.CHROMIUM_MODULE
  ? (await import(process.env.CHROMIUM_MODULE)).default
  : null;
const browser = await chromium.launch(
  bundled
    ? {
        headless: true,
        args: bundled.args.filter(
          (arg) =>
            !["--disable-web-security", "--single-process"].includes(arg),
        ),
        executablePath:
          process.env.CHROMIUM_EXECUTABLE || (await bundled.executablePath()),
      }
    : { headless: true },
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const buyerContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const buyer = await buyerContext.newPage();
page.setDefaultTimeout(15000);
buyer.setDefaultTimeout(15000);
const errors = [];
const checks = [];
page.on("pageerror", (e) => errors.push(e.message));
buyer.on("pageerror", (e) => errors.push(e.message));
const money = (n) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
  }).format(Number(n) / 100);
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
function passed(check) {
  checks.push(check);
  console.log("PASS", check);
}
async function signIn(ctx, role) {
  const r = await ctx.request.post(base + "/api/auth", {
    headers: { origin: base },
    data: { action: "demo", role },
  });
  assert.ok(r.ok(), "Local sign-in " + r.status());
}
async function state(ctx = context) {
  const r = await ctx.request.get(base + "/api/state");
  assert.ok(r.ok(), "State " + r.status());
  return r.json();
}
async function command(ctx, action, payload) {
  const r = await ctx.request.post(base + "/api/command", {
    headers: { origin: base },
    data: {
      action,
      payload,
      key: randomUUID(),
      tenant_id: "11111111-1111-4111-8111-111111111111",
    },
  });
  const d = await r.json();
  assert.ok(r.ok(), action + ": " + JSON.stringify(d));
  return d;
}
async function submit(button) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/command") && r.request().method() === "POST",
  );
  await button.click();
  const r = await response;
  assert.ok(r.ok(), "Browser command " + (await r.text()));
  return r.json();
}
async function shot(p, name) {
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    "Horizontal overflow " + name,
  );
  await p.screenshot({ path: output + "/" + name + ".png", fullPage: true });
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error("Server stopped: " + serverLog);
    try {
      if ((await fetch(base + "/login")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(ready, "Server did not start: " + serverLog);
  await signIn(context, "owner");
  await signIn(buyerContext, "client");
  const initial = await state(buyerContext);
  const contract = initial.contracts.find(
    (c) =>
      ["signed", "transferred"].includes(c.status) &&
      BigInt(c.sale_price) -
        initial.payments
          .filter((p) => p.contract_id === c.id)
          .reduce((n, p) => n + BigInt(p.amount), 0n) >
        20000n,
  );
  assert.ok(contract, "Need an active LOCAL demo contract");
  for (const claim of initial.payment_claims.filter(
    (c) => c.contract_id === contract.id && c.status === "pending",
  ))
    await command(context, "portal.reject", {
      id: claim.id,
      reason: "Завершение локальной проверки интерфейса",
    });
  const before = await state();
  const customer = before.customers.find((c) => c.id === contract.customer_id);
  const account = before.cash_accounts.find(
    (a) => a.tenant_id === contract.tenant_id,
  );
  assert.ok(account);
  await page.goto(base + "/crm/contracts");
  await page.getByRole("heading", { name: "Договоры", exact: true }).waitFor();
  await page
    .getByLabel("Поиск договоров")
    .fill(customer.phone.replace(/\D/g, ""));
  await expect
    .poll(async () => {
      const names = await page.locator(".portfolio-card h2").allTextContents();
      return names.length > 0 && names.every((n) => n === customer.name);
    })
    .toBe(true);
  await page.getByLabel("Поиск договоров").fill("Неизвестный клиент 54321");
  await page.getByRole("heading", { name: "Договоры не найдены" }).waitFor();
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await page.getByRole("button", { name: /^С просрочкой/ }).click();
  await page.waitForURL(/status=overdue/);
  assert.ok(
    (await page.locator(".portfolio-card .badge").allTextContents()).every(
      (s) => s === "Просрочка",
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^С просрочкой/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await shot(page, "contracts-mobile");
  passed("Contract search, overdue filter and reload");

  await buyer.goto(base + "/cabinet?view=payments&contract=" + contract.id);
  const report = buyer
    .locator("form")
    .filter({ has: buyer.locator('select[name="contract_id"]') });
  await report.locator('input[name="amount"]').fill("123,45");
  await report.locator('select[name="method"]').selectOption("sbp");
  const reportResponse = buyer.waitForResponse(
    (r) => r.url().endsWith("/api/command") && r.request().method() === "POST",
  );
  await report
    .getByRole("button", { name: "Я оплатил — отправить на проверку" })
    .click();
  const sent = await reportResponse;
  assert.ok(sent.ok(), await sent.text());
  const claimResult = await sent.json();
  await expect(
    buyer.getByRole("button", { name: "Сообщение на проверке", exact: true }),
  ).toBeDisabled();
  assert.equal((await state()).payments.length, before.payments.length);
  passed("Buyer report does not change debt; duplicate disabled");

  await page.goto(base + "/crm/payments");
  const claimCard = page
    .locator(".finance-claim")
    .filter({ hasText: money("12345") })
    .filter({ hasText: contract.number });
  await claimCard
    .getByRole("button", { name: "Проверить поступление" })
    .click();
  assert.equal(
    await claimCard.locator("form").evaluate((f) => f.checkValidity()),
    false,
  );
  await claimCard.locator('select[name="account"]').selectOption(account.id);
  assert.equal(
    await claimCard.locator("form").evaluate((f) => f.checkValidity()),
    false,
  );
  await claimCard.getByRole("checkbox").check();
  await shot(page, "payment-review-mobile");
  await submit(
    claimCard.getByRole("button", { name: "Подтвердить оплату", exact: true }),
  );
  await expect(claimCard).toHaveCount(0);
  const confirmed = await state();
  const confirmedClaim = confirmed.payment_claims.find(
    (c) => c.id === claimResult.id,
  );
  assert.equal(confirmedClaim.status, "confirmed");
  assert.equal(confirmed.payments.length, before.payments.length + 1);
  assert.equal(
    String(
      confirmed.payments.find((p) => p.id === confirmedClaim.payment_id).amount,
    ),
    "12345",
  );
  passed(
    "Confirmation requires account and verification; creates one exact receipt",
  );

  const rejectedClaim = await command(buyerContext, "portal.claim", {
    contract_id: contract.id,
    amount: "2000",
    method: "cash",
    paid_on: day,
  });
  await page.getByRole("button", { name: "Обновить рабочий кабинет" }).click();
  const rejectCard = page
    .locator(".finance-claim")
    .filter({ hasText: money("2000") })
    .filter({ hasText: contract.number });
  await rejectCard
    .getByRole("button", { name: "Проверить поступление" })
    .click();
  await rejectCard.getByRole("button", { name: "Деньги не поступили" }).click();
  await rejectCard
    .locator('textarea[name="reason"]')
    .fill("Наличные не получены");
  await submit(
    rejectCard.getByRole("button", {
      name: "Отклонить сообщение",
      exact: true,
    }),
  );
  assert.equal((await state()).payments.length, confirmed.payments.length);
  assert.equal(
    (await state()).payment_claims.find((c) => c.id === rejectedClaim.id)
      .reason,
    "Наличные не получены",
  );
  passed("Rejection keeps debt and saves reason");

  await page.getByRole("button", { name: "История", exact: true }).click();
  await page.waitForURL(/view=history/);
  await page.getByLabel("Поиск поступлений").fill(contract.number);
  const payment = page
    .locator(".finance-payment")
    .filter({ hasText: money("12345") })
    .filter({ hasText: contract.number })
    .filter({
      has: page.getByRole("button", { name: "Отменить ошибочную запись" }),
    });
  await shot(page, "payment-history-mobile");
  await payment
    .getByRole("button", { name: "Отменить ошибочную запись" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Отменить поступление?" });
  await dialog.waitFor();
  assert.equal(
    await dialog.locator("form").evaluate((f) => f.checkValidity()),
    false,
  );
  await dialog
    .locator('textarea[name="reason"]')
    .fill("Локальная проверка отмены ошибочной записи");
  await shot(page, "receipt-reversal-dialog");
  await submit(
    dialog.getByRole("button", { name: "Подтвердить отмену записи" }),
  );
  await dialog.waitFor({ state: "hidden" });
  const reversed = await state();
  assert.ok(reversed.payments.some((p) => p.id === confirmedClaim.payment_id));
  assert.equal(
    String(
      reversed.payments.find((p) => p.reversal_of === confirmedClaim.payment_id)
        .amount,
    ),
    "-12345",
  );
  await buyer.reload();
  await buyer
    .getByText(
      "Продавец отменил запись о поступлении. Сумма снова учитывается в остатке долга.",
    )
    .first()
    .waitFor();
  passed("Reversal preserves original and corrects buyer status");

  await page
    .getByRole("button", { name: "Записать платёж", exact: true })
    .click();
  await page.waitForURL(/view=record/);
  const form = page.locator(".receipt-form");
  await form.locator('select[name="contract_id"]').selectOption(contract.id);
  await form.getByRole("button", { name: /^По графику:/ }).click();
  assert.ok(await form.locator('input[name="amount"]').inputValue());
  await form.locator('input[name="amount"]').fill("23,45");
  await form.locator('select[name="cash_account_id"]').selectOption(account.id);
  await form.getByRole("checkbox").check();
  await shot(page, "receipt-form-mobile");
  await page.route(
    "**/api/state",
    (route) =>
      route.fulfill({ status: 503, json: { error: "Local failure check" } }),
    { times: 1 },
  );
  const manual = await submit(
    form.getByRole("button", { name: "Записать поступление" }),
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Операция сохранена, но экран не обновился" })
    .waitFor();
  await expect(form.locator('input[name="amount"]')).toHaveValue("");
  await expect(form.locator('select[name="contract_id"]')).toHaveValue("");
  const afterFailure = await state();
  assert.equal(
    afterFailure.payments.filter((p) => p.id === manual.id).length,
    1,
  );
  await form.locator('select[name="contract_id"]').selectOption(contract.id);
  await form.locator('input[name="amount"]').fill("23,45");
  await form.locator('select[name="cash_account_id"]').selectOption(account.id);
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Записать поступление" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Сначала обновите данные" })
    .waitFor();
  assert.equal((await state()).payments.length, afterFailure.payments.length);
  await page.getByRole("button", { name: "Обновить рабочий кабинет" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Данные обновлены" })
    .waitFor();
  await command(context, "payment.reverse", {
    id: manual.id,
    reason: "Завершение локальной проверки сети",
  });
  passed(
    "Successful write plus failed refresh cannot duplicate; refresh recovers",
  );

  await signIn(context, "cashier");
  await page.goto(base + "/crm/payments?view=history");
  await page
    .getByRole("heading", { name: "История поступлений", exact: true })
    .waitFor();
  assert.equal(await page.locator(".finance-cancel").count(), 0);
  await signIn(context, "manager");
  await page.goto(base + "/crm/payments");
  assert.equal(await page.locator(".finance-workspace").count(), 0);
  passed("Role controls preserved");
  await signIn(context, "owner");
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(base + "/crm/payments?view=history");
  await page
    .getByRole("heading", { name: "История поступлений", exact: true })
    .waitFor();
  await shot(page, "history-small-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + "/crm/contracts");
  await page.getByRole("heading", { name: "Договоры", exact: true }).waitFor();
  await shot(page, "contracts-desktop");
  await page.goto(base + "/crm/payments?view=history");
  await page
    .getByRole("heading", { name: "История поступлений", exact: true })
    .waitFor();
  await shot(page, "history-desktop");
  assert.deepEqual(errors, []);
  passed("360/390/1280px and no browser runtime errors");
  await writeFile(
    output + "/verification.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (e) {
  await writeFile(output + "/failed-server.log", serverLog);
  await writeFile(output + "/browser-errors.json", JSON.stringify(errors));
  await page
    .screenshot({ path: output + "/failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
  if (server.exitCode === null) {
    const closed = once(server, "close");
    server.kill("SIGTERM");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]);
  }
}
