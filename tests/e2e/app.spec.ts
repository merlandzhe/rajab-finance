import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:3000";
test("root goes directly to HESAP Mini App, not legacy marketing site", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/mini$/);
  await expect(page.getByRole("heading", { name: "Рассрочка под контролем" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Я покупатель/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Я предприниматель/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Важные покупки/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test("merchant access starts with real onboarding, not demo roles", async ({ page }) => {
  await page.goto("/mini/merchant");
  await expect(page.getByRole("heading", { name: "Кабинет магазина" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Подключить магазин/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "У меня есть код" })).toBeVisible();
  await page.getByText("Помощь с подключением").click();
  await expect(page.getByRole("link", { name: "Написать владельцу HESAP" })).toHaveAttribute("href", "https://t.me/merlandzhe");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test("merchant can submit a shop request and switch to activation", async ({ page }) => {
  await page.route("https://telegram.org/**", route => route.fulfill({body: ""}));
  await page.addInitScript(() => {
    const noop = () => {};
    Object.assign(window, { Telegram: { WebApp: {
      initData: "browser-test", ready: noop, expand: noop, onEvent: noop, offEvent: noop,
      BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
    } } });
  });
  await page.route("**/api/auth/telegram", route => route.fulfill({json: {path: "/cabinet"}}));
  await page.route("**/api/merchant-request", async route => {
    if (route.request().method() === "GET") return route.fulfill({json: null});
    expect(route.request().postDataJSON()).toEqual({shop_name: "Магазин", city: "Грозный", name: "Адам", phone: "+79991234567"});
    await route.fulfill({json: {status: "new"}});
  });
  await page.goto("/mini/merchant");
  await page.getByRole("button", {name: /Подключить магазин/}).click();
  await page.getByLabel("Название магазина").fill("Магазин");
  await page.getByLabel("Город").fill("Грозный");
  await page.getByLabel("Имя", {exact: true}).fill("Адам");
  await page.getByLabel("Контактный телефон").fill("+7 999 123-45-67");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", {name: "Отправить заявку"}).click();
  await expect(page.getByRole("status")).toContainText("Заявка отправлена");
  await page.getByRole("button", {name: "У меня есть код"}).click();
  await expect(page.getByLabel("Одноразовый код")).toBeVisible();
});
test("anonymous customer, owner and payment data are protected", async ({ page, request }) => {
  await page.goto("/crm");
  await expect(page).toHaveURL(/\/mini$/);
  expect((await request.get("/api/state")).status()).toBe(401);
  expect((await request.get("/api/platform/access")).status()).toBe(401);
  expect((await request.post("/api/command", { headers: { Origin: origin }, data: {} })).status()).toBe(401);
});
test("legacy demo sign-in and public intake are gone", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/mini$/);
  const login = await request.post("/api/auth", {
    headers: { Origin: origin },
    data: { action: "demo", role: "owner" },
  });
  expect(login.ok()).toBe(false);
  const intake = await request.post("/api/intake", {
    headers: { Origin: origin },
    data: {},
  });
  expect(intake.status()).toBe(404);
});
