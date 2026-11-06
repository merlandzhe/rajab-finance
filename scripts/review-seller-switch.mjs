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
  await signIn(context, "buyer");
  for(const data of [{action:"profile",name:"Проверка выбора",city:"Москва",consent:true},{action:"select",tenant_id:"11111111-1111-4111-8111-111111111111"}]) {
    const r=await context.request.post(base+"/api/buyer",{headers:{origin:base},data});assert.ok(r.ok(),await r.text());
  }
  await page.goto(base+"/cabinet?view=applications");
  await page.locator(".seller-switch").click();
  await page.getByRole("heading",{name:"Выберите продавца",exact:true}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"Данные покупателя"}).count(),0);
  const response=page.waitForResponse(r=>r.url().endsWith("/api/buyer")&&r.request().method()==="POST");
  await page.getByRole("button",{name:/Продавец Б/}).click();assert.ok((await response).ok());
  await page.waitForURL(base+"/cabinet?view=applications");
  const data=await (await context.request.get(base+"/api/buyer")).json();
  assert.equal(data.profile.active_tenant,"22222222-2222-4222-8222-222222222222");
  assert.ok((await state()).organizations.every(o=>o.id==="22222222-2222-4222-8222-222222222222"));
  await page.goto(base+"/cabinet/setup?mode=profile");
  const field=page.locator('input[name="name"]');await field.waitFor();
  assert.equal(await field.evaluate(e=>getComputedStyle(e).webkitTextFillColor),"rgb(20, 45, 62)");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);passed("Seller switch reloads tenant and profile fields have readable text");
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
