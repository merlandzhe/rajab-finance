import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
const origin = "http://127.0.0.1:3000";
test("landing calculator and mobile overflow", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Важные покупки/ }),
  ).toBeVisible();
  await page.getByLabel("Стоимость товара, ₽").fill("100000");
  await page.getByLabel("Первоначальный взнос, ₽").fill("20000");
  await page.getByRole("button", { name: "3 мес." }).click();
  await page
    .getByRole("button", { name: "Посмотреть график платежей" })
    .click();
  await expect(
    page.getByRole("heading", { name: "График платежей" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
test("unauthenticated admin and API are protected", async ({
  page,
  request,
}) => {
  await page.goto("/crm");
  await expect(page).toHaveURL(/login/);
  expect((await request.get("/api/state")).status()).toBe(401);
  expect(
    (
      await request.post("/api/command", {
        data: {},
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/auth", {
        data: { action: "demo", role: "owner" },
        headers: { Origin: "https://attacker.invalid" },
      })
    ).status(),
  ).toBe(403);
});
test("owner creates customer and request; unsigned purchase gate; PDF; tariff history", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Войти как Раджап · демо" }).click();
  await expect(page.locator(".merchant-overview")).toBeVisible();
  await page.goto("/crm/customers/new");
  const name = "Тест E2E " + randomUUID().slice(0, 8);
  await page.getByLabel("ФИО / имя клиента").fill(name);
  await page.getByLabel("Телефон", { exact: true }).fill("+7 000 000 99 01");
  await page.getByRole("button", { name: "Создать клиента" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.goto("/crm/applications/new");
  await page
    .getByLabel("Клиент", { exact: true })
    .selectOption({ label: name });
  await page.getByLabel("Наименование товара").fill("Тестовый ноутбук E2E");
  await page.getByRole("button", { name: "Создать заявку" }).click();
  await expect(
    page.getByRole("heading", { name: "Тестовый ноутбук E2E" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Заключить демо-договор" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Одобрить заявку" }).click();
  await page.getByRole("button", { name: "Перейти к закупке" }).click();
  await expect(
    page.getByRole("button", { name: "Зафиксировать закупку" }),
  ).toBeDisabled();
  await page.goto("/crm/contracts");
  await page
    .getByRole("link", { name: /^Открыть RF/ })
    .first()
    .click();
  const pdfUrl = await page
    .getByRole("link", { name: "Скачать PDF" })
    .getAttribute("href");
  const pdf = await page.request.get(pdfUrl!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.goto("/crm/settings/markups");
  await expect(
    page.getByRole("heading", { name: "Правило ценообразования" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
test("client sees only own contracts and cannot mutate or access another PDF", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Клиент", exact: true }).click();
  await expect(page).toHaveURL(/cabinet/);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.contracts).toHaveLength(1);
  expect(state.applications.length).toBeGreaterThan(0);
  expect(
    state.applications.every((a: { customer_id: string; tenant_id: string }) =>
      state.customers.some((c: { id: string; tenant_id: string }) =>
        c.id === a.customer_id && c.tenant_id === a.tenant_id,
      ),
    ),
  ).toBe(true);
  const denied = await page.request.post("/api/command", {
    headers: { Origin: origin },
    data: {
      action: "customer.create",
      payload: { name: "Попытка", phone: "+7 000 000 00 00" },
      key: randomUUID(),
    },
  });
  expect(denied.status()).toBe(403);
  expect(
    (
      await page.request.get("/api/contracts/" + randomUUID() + "/pdf")
    ).status(),
  ).toBe(404);
  await page.goto("/crm/settings");
  await expect(page).toHaveURL(/cabinet/);
});
