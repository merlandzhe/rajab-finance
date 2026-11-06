// Local-only browser verification. No hosted writes or Telegram messages.
// CHROMIUM_MODULE may point to a separately installed @sparticuz/chromium module.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
const base = process.env.REVIEW_START_SERVER
  ? "http://127.0.0.1:3100"
  : "http://127.0.0.1:3000";
const server = process.env.REVIEW_START_SERVER
  ? spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
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
    )
  : null;
let serverLog = "";
server?.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
server?.stderr.on("data", (chunk) => {
  serverLog += chunk;
});
const output = process.env.REVIEW_OUTPUT || "/tmp/hesap-review";
await mkdir(output, { recursive: true });
const bundled = process.env.CHROMIUM_MODULE
  ? (await import(process.env.CHROMIUM_MODULE)).default
  : null;
const browser = await chromium.launch(
  bundled
    ? {
        headless: true,
        args: bundled.args,
        executablePath:
          process.env.CHROMIUM_EXECUTABLE || (await bundled.executablePath()),
      }
    : { headless: true },
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function signIn(role) {
  const result = await context.request.post(base + "/api/auth", {
    headers: { origin: base },
    data: { action: "demo", role },
  });
  assert.ok(result.ok(), "Local sign-in " + result.status());
}
async function shot(name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Horizontal overflow: " + name,
  );
  await page.screenshot({ path: output + "/" + name + ".png", fullPage: true });
}
try {
  if (server) {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null)
        throw Error("Local server stopped: " + serverLog);
      try {
        const r = await fetch(base + "/login");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.ok(ready, "Server did not start: " + serverLog);
  }
  await signIn("owner");
  await page.goto(base + "/crm");
  await page.getByRole("heading", { name: "Календарь платежей" }).waitFor();
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Клиенты", exact: true })
    .click();
  await page.waitForURL("**/crm/customers");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  await page.goto(base + "/crm");
  await page.getByRole("button", { name: /^Просрочены/ }).click();
  const dates = await page
    .locator(".payment-row small:last-child")
    .allTextContents();
  assert.ok(dates.every((text) => text.includes("Просрочено")));
  await shot("merchant-overview");
  await page.getByLabel("Поиск платежей").fill("Несуществующий клиент");
  await page.getByRole("heading", { name: "Таких платежей нет" }).waitFor();
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await page.goto(base + "/crm/applications?status=review");
  await page.getByLabel("Статус заявки").waitFor();
  assert.equal(await page.getByLabel("Статус заявки").inputValue(), "review");
  assert.equal(
    await page.locator(".desktop-application-table").isVisible(),
    false,
  );
  await shot("merchant-applications");
  await signIn("manager");
  await page.goto(base + "/crm");
  await page.getByRole("heading", { name: "Календарь платежей" }).waitFor();
  assert.equal(
    await page.locator('.overview-tile[href="/crm/payments"]').count(),
    0,
  );
  await signIn("cashier");
  await page.goto(base + "/crm");
  await page.getByRole("heading", { name: "Календарь платежей" }).waitFor();
  assert.equal(
    await page.locator('.overview-tile[href*="applications"]').count(),
    0,
  );
  await signIn("client");
  await page.goto(base + "/cabinet");
  await page.getByRole("heading", { name: "Мои рассрочки" }).waitFor();
  await shot("buyer-home");
  await page
    .getByRole("button", { name: "График и оплата", exact: true })
    .first()
    .click();
  await page.waitForURL(/view=payments.*contract=/);
  await page.getByRole("heading", { name: "Платежи", exact: true }).waitFor();
  const selected = new URL(page.url()).searchParams.get("contract");
  assert.ok(selected);
  const claimContracts = await page
    .locator('select[name="contract_id"] option')
    .evaluateAll((options) => options.map((o) => o.value));
  assert.ok(
    claimContracts.every((id) => id === selected),
    "Claim form mixed contracts",
  );
  await page.getByRole("button", { name: /^Оплачены/ }).click();
  assert.equal(
    await page.locator(".schedule-item:not(:has(.is-paid))").count(),
    0,
  );
  await shot("buyer-payments");
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  await page.waitForURL(/view=profile/);
  assert.equal(
    await page.getByText("Уведомления в Telegram", { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  await page.waitForURL(/view=notifications/);
  await page.getByText("Уведомления в Telegram", { exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  await signIn("platform");
  await page.route("**/api/platform/access", (route) =>
    route.fulfill({
      json: {
        requests: [
          {
            id: "r",
            name: "Проверка интерфейса",
            shop_name: "Магазин техники",
            city: "Москва",
            phone: "+79990000000",
            telegram_id: 1,
            username: null,
            status: "new",
          },
        ],
        companies: [
          {
            id: "a",
            name: "Скоро продление",
            status: "active",
            expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
            linked: true,
            archived: false,
          },
          {
            id: "b",
            name: "Заблокированная компания",
            status: "blocked",
            expires_at: null,
            linked: true,
            archived: false,
          },
          {
            id: "c",
            name: "Удалённая компания",
            status: "blocked",
            expires_at: null,
            linked: false,
            archived: true,
          },
        ],
        codes: [],
        delivery: { pending: 0, failed: 0 },
      },
    }),
  );
  await page.goto(base + "/crm/platform");
  await page.getByRole("button", { name: /^Продлить/ }).click();
  await page
    .getByRole("heading", { name: "Скоро продление", exact: true })
    .waitFor();
  assert.equal(await page.locator(".directory-card").count(), 1);
  await shot("owner-companies");
  await page.getByRole("button", { name: /^Удалённые/ }).click();
  await page
    .getByRole("heading", { name: "Удалённая компания", exact: true })
    .waitFor();
  await page.goto(base + "/crm/platform-requests");
  await page
    .getByRole("heading", { name: "Магазин техники", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Управление компанией", { exact: true }).count(),
    0,
  );
  await shot("owner-requests");
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn("owner");
  await page.goto(base + "/crm/applications");
  await page.getByRole("heading", { name: "Заявки", exact: true }).waitFor();
  assert.equal(
    await page.locator(".desktop-application-table").isVisible(),
    true,
  );
  assert.equal(
    await page.locator(".mobile-application-list").isVisible(),
    false,
  );
  await shot("desktop-applications");
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(
    "Passed: mobile/desktop layouts, deadline/search filters, role-aware actions, selected-contract payment form, buyer history/reload, separate owner sections.",
  );
} finally {
  await browser.close();
  server?.kill("SIGTERM");
}
