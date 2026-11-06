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
  await expect(page.getByRole("heading", { name: "HESAP для бизнеса" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Получить доступ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "У меня есть код" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Написать владельцу HESAP" })).toHaveAttribute("href", "https://t.me/merlandzhe");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
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
