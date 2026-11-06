import next from "next";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { today, addMonths } from "../src/lib/money";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
process.env.DEMO_MODE = "true";
process.env.APP_ORIGIN = "http://localhost:3000";
const app = next({ dev: false, dir: process.cwd() });
await app.prepare();
const handler = app.getRequestHandler();
async function request(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    origin?: string;
    contentType?: string;
  } = {},
) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    highWaterMark: 1024 * 1024,
    read() {},
    write(chunk, _encoding, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  }) as Socket;
  const req = new IncomingMessage(socket);
  req.method = options.method ?? "GET";
  req.url = url;
  req.headers = {
    host: "localhost:3000",
    origin: options.origin ?? "http://localhost:3000",
    ...(options.cookie ? { cookie: options.cookie } : {}),
  };
  req.httpVersion = "1.1";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  if (options.body !== undefined) {
    const body = Buffer.isBuffer(options.body)
      ? options.body
      : JSON.stringify(options.body);
    req.headers["content-type"] = options.contentType ?? "application/json";
    req.headers["content-length"] = String(Buffer.byteLength(body));
    req.push(Buffer.from(body));
  }
  req.push(null);
  req.complete = true;
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  socket.on("drain", () => res.emit("drain"));
  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Response timeout: " + url)),
      20000,
    );
    res.once("finish", () => clearTimeout(timeout));
    res.once("finish", resolve);
    res.once("error", reject);
  });
  await Promise.all([handler(req, res), completed]);
  const raw = Buffer.concat(chunks);
  const index = raw.indexOf("\r\n\r\n");
  let body = raw.subarray(index + 4);
  const header = raw.subarray(0, index).toString();
  if (/transfer-encoding: chunked/i.test(header)) {
    const decoded: Buffer[] = [];
    let pos = 0;
    while (pos < body.length) {
      const end = body.indexOf("\r\n", pos);
      const size = parseInt(body.subarray(pos, end).toString(), 16);
      if (!size) break;
      decoded.push(body.subarray(end + 2, end + 2 + size));
      pos = end + 2 + size + 2;
    }
    body = Buffer.concat(decoded);
  }
  return { status: res.statusCode, body, headers: res.getHeaders() };
}

let checks = 0;
function check(label: string, ok: boolean) {
  assert.ok(ok, label);
  checks++;
  console.log("PASS", label);
}
function cookieOf(headers: ReturnType<ServerResponse["getHeaders"]>) {
  const items = headers["set-cookie"];
  return (Array.isArray(items) ? items : [String(items)])
    .map((v) => v.split(";")[0])
    .join("; ");
}
async function login(role: string) {
  const r = await request("/api/auth", {
    method: "POST",
    body: { action: "demo", role },
  });
  check("demo login " + role, r.status === 200);
  return cookieOf(r.headers);
}
const home = await request("/");
check(
  "home renders",
  home.status === 200 && home.body.toString().includes("Важные покупки"),
);
await mkdir(".demo/http-check", { recursive: true });
await writeFile(".demo/http-check/home.html", home.body);
check(
  "unauthenticated state denied",
  (await request("/api/state")).status === 401,
);
check(
  "forged cookie denied",
  (await request("/api/state", { cookie: "rajab_demo=forged" })).status === 401,
);
check(
  "foreign origin denied",
  (
    await request("/api/auth", {
      method: "POST",
      body: { action: "demo", role: "owner" },
      origin: "https://attacker.invalid",
    })
  ).status === 403,
);
const cookie = await login("owner");
for (const url of ["/api/auth/telegram", "/api/telegram/invite"]) {
  const r = await request(url, {
    method: "POST",
    body: { initData: "forged" },
    cookie,
  });
  check("Telegram disabled in demo: " + url, r.status === 403);
  const cross = await request(url, {
    method: "POST",
    body: {},
    origin: "https://attacker.invalid",
  });
  check("Telegram rejects foreign origin: " + url, cross.status === 403);
}
for (const url of [
  "/mini",
  "/login",
  "/terms",
  "/privacy",
  "/murabaha",
  "/crm",
  "/crm/customers",
  "/crm/applications",
  "/crm/contracts",
  "/crm/payments",
  "/crm/cash",
  "/crm/settings/markups",
  "/crm/reports",
  "/crm/calculator",
  "/crm/notifications",
]) {
  const r = await request(url, { cookie });
  check("page " + url, r.status === 200);
  if (url === "/crm") await writeFile(".demo/http-check/crm.html", r.body);
}
const data = JSON.parse(
  (await request("/api/state", { cookie })).body.toString(),
);
check("owner state contains contracts", data.contracts.length >= 6);
async function command(action: string, payload: unknown, key = randomUUID()) {
  const r = await request("/api/command", {
    method: "POST",
    cookie,
    body: { action, payload, key },
  });
  check(action, r.status === 200);
  return JSON.parse(r.body.toString());
}
const customer = await command("customer.create", {
  name: "HTTP Тестовый Клиент",
  phone: "+7 000 000 88 88",
  notes: "Вымышленная запись",
});
const a = await command("application.create", {
  customer_id: customer.id,
  product_name: "HTTP Тестовый товар",
  supplier: "Тестовый поставщик",
  estimated_cost: "10000000",
  down_payment: "1000000",
  months: 6,
});
check(
  "contract before purchase denied",
  (
    await request("/api/command", {
      method: "POST",
      cookie,
      body: {
        action: "contract.create",
        payload: { id: a.id },
        key: randomUUID(),
      },
    })
  ).status === 400,
);
await command("application.transition", { id: a.id, status: "approved" });
await command("application.transition", {
  id: a.id,
  status: "awaiting_purchase",
});
const form = new FormData();
form.set("application_id", a.id);
form.set("kind", "purchase_receipt");
form.set(
  "file",
  new Blob([await readFile("docs/examples/demo-contract.pdf")], {
    type: "application/pdf",
  }),
  "demo-purchase.pdf",
);
const formRequest = new Request("http://localhost:3000/api/upload", {
  method: "POST",
  body: form,
});
const uploaded = await request("/api/upload", {
  method: "POST",
  cookie,
  contentType: formRequest.headers.get("content-type")!,
  body: Buffer.from(await formRequest.arrayBuffer()),
});
check("validated document upload", uploaded.status === 200);
const document = JSON.parse(uploaded.body.toString());
check(
  "private document download",
  (await request("/api/documents/" + document.id, { cookie })).status === 200,
);
await command("purchase.record", {
  id: a.id,
  supplier: "Тестовый поставщик",
  cost: "10000000",
  purchased_on: today(),
  document_id: document.id,
  ownership_confirmed: true,
});
await command("quote.confirm", {
  id: a.id,
  months: 6,
  down_payment: "1000000",
  first_payment_on: addMonths(today(), 1),
  agreed: true,
  custom_kind: "rubles",
  custom_value: "1234567",
});
const contract = await command("contract.create", { id: a.id });
const pdf = await request("/api/contracts/" + contract.id + "/pdf", { cookie });
check(
  "server-generated contract PDF",
  pdf.status === 200 && pdf.body.subarray(0, 5).toString() === "%PDF-",
);
await command("contract.transfer", {
  id: contract.id,
  transferred_on: today(),
  reference: "Тестовый акт HTTP",
});
const paymentKey = randomUUID();
const payload = {
  contract_id: contract.id,
  cash_account_id: data.cash_accounts[0].id,
  amount: "1000000",
  paid_on: today(),
};
const payment = await command("payment.record", payload, paymentKey);
const repeated = await command("payment.record", payload, paymentKey);
check("HTTP idempotent payment", payment.id === repeated.id);
await command("payment.record", { ...payload, amount: "10234567" });
const settled = JSON.parse(
  (await request("/api/state", { cookie })).body.toString(),
);
check(
  "paid and transferred contract closed",
  settled.contracts.find((c: { id: string }) => c.id === contract.id).status ===
    "closed",
);
await command("payment.reverse", {
  id: payment.id,
  reason: "Тестовая отмена ошибочного поступления",
});
const clientCookie = await login("client");
const clientState = JSON.parse(
  (await request("/api/state", { cookie: clientCookie })).body.toString(),
);
check(
  "client only sees own contract",
  clientState.contracts.length === 1 &&
    clientState.applications.every(
      (a: { customer_id: string }) =>
        a.customer_id === clientState.customers[0].id,
    ),
);
check(
  "client foreign PDF denied",
  (
    await request("/api/contracts/" + contract.id + "/pdf", {
      cookie: clientCookie,
    })
  ).status === 404,
);
check(
  "client mutation denied",
  (
    await request("/api/command", {
      method: "POST",
      cookie: clientCookie,
      body: {
        action: "customer.create",
        payload: { name: "Тест", phone: "+7 000 000 00 00" },
        key: randomUUID(),
      },
    })
  ).status === 403,
);
check(
  "client cabinet renders",
  (await request("/cabinet", { cookie: clientCookie })).status === 200,
);
const otherCookie = await login("other");
check(
  "client can submit an application",
  (
    await request("/api/command", {
      method: "POST",
      cookie: clientCookie,
      body: {
        action: "portal.application",
        key: randomUUID(),
        payload: {
          product_name: "Тестовый ноутбук",
          product_url: "",
          estimated_cost: "100000",
          down_payment: "0",
          months: 6,
          notes: "",
        },
      },
    })
  ).status === 200,
);
check(
  "client cannot confirm own payment",
  (
    await request("/api/command", {
      method: "POST",
      cookie: clientCookie,
      body: {
        action: "portal.confirm",
        key: randomUUID(),
        payload: { id: randomUUID(), cash_account_id: randomUUID() },
      },
    })
  ).status !== 200,
);
const otherState = JSON.parse(
  (await request("/api/state", { cookie: otherCookie })).body.toString(),
);
check("other tenant isolated", otherState.contracts.length === 0);
check(
  "other tenant cannot download document",
  (await request("/api/documents/" + document.id, { cookie: otherCookie }))
    .status === 404,
);
check(
  "Telegram dispatch disabled in demo",
  (await request("/api/telegram")).status === 401,
);
const intake = await request("/api/intake", {
  method: "POST",
  body: {
    name: "Тестовый посетитель",
    phone: "+7 000 000 77 77",
    product_name: "Тестовый товар",
    estimated_cost: "5000000",
    down_payment: "0",
    months: 6,
    notes: "",
    consent: true,
    website: "",
    key: randomUUID(),
  },
});
check("public synthetic intake", intake.status === 200);
const logout = await request("/api/auth", {
  method: "POST",
  cookie,
  body: { action: "logout" },
});
check(
  "logout clears session",
  logout.status === 200 &&
    String(logout.headers["set-cookie"]).includes("rajab_demo="),
);

const buyerCookie = await login("buyer");
const buyerState = await request("/api/buyer", { cookie: buyerCookie });
check(
  "buyer onboarding state",
  buyerState.status === 200 &&
    JSON.parse(buyerState.body.toString()).sellers.length >= 1,
);
check(
  "buyer setup page renders",
  (await request("/cabinet/setup", { cookie: buyerCookie })).body
    .toString()
    .includes("Начнём знакомство"),
);
check(
  "buyer profile rejects spoofed phone",
  (
    await request("/api/buyer", {
      method: "POST",
      cookie: buyerCookie,
      body: {
        action: "profile",
        name: "Тестовый покупатель",
        city: "Раменское",
        consent: true,
        phone_verified_at: "now",
      },
    })
  ).status === 400,
);
check(
  "buyer profile saves",
  (
    await request("/api/buyer", {
      method: "POST",
      cookie: buyerCookie,
      body: {
        action: "profile",
        name: "Тестовый покупатель",
        city: "Раменское",
        consent: true,
      },
    })
  ).status === 200,
);
const tenant = "11111111-1111-4111-8111-111111111111";
check(
  "buyer selects seller",
  (
    await request("/api/buyer", {
      method: "POST",
      cookie: buyerCookie,
      body: { action: "select", tenant_id: tenant },
    })
  ).status === 200,
);
check(
  "owner cannot use buyer onboarding",
  (
    await request("/api/buyer", {
      method: "POST",
      cookie,
      body: { action: "select", tenant_id: tenant },
    })
  ).status === 403,
);
const newApplication = {
  product_name: "Новая заявка покупателя",
  product_url: "https://example.invalid/item",
  estimated_cost: "500000",
  down_payment: "0",
  months: 3,
  notes: "Синтетический HTTP тест",
};
check(
  "buyer stale tenant denied",
  (
    await request("/api/command", {
      method: "POST",
      cookie: buyerCookie,
      body: {
        action: "portal.application",
        payload: newApplication,
        key: randomUUID(),
        tenant_id: "22222222-2222-4222-8222-222222222222",
      },
    })
  ).status === 400,
);
const submitted = await request("/api/command", {
  method: "POST",
  cookie: buyerCookie,
  body: {
    action: "portal.application",
    payload: newApplication,
    key: randomUUID(),
    tenant_id: tenant,
  },
});
check("new buyer submits application", submitted.status === 200);
const submittedId = JSON.parse(submitted.body.toString()).id;
check(
  "seller asks clarification",
  (
    await request("/api/command", {
      method: "POST",
      cookie,
      body: {
        action: "portal.clarify",
        payload: { id: submittedId, message: "Уточните цвет товара" },
        key: randomUUID(),
      },
    })
  ).status === 200,
);
check(
  "buyer replies",
  (
    await request("/api/command", {
      method: "POST",
      cookie: buyerCookie,
      body: {
        action: "portal.reply",
        payload: { id: submittedId, message: "Нужен белый цвет" },
        key: randomUUID(),
        tenant_id: tenant,
      },
    })
  ).status === 200,
);
const buyerCabinet = await request("/cabinet", { cookie: buyerCookie });
check(
  "buyer cabinet renders application and clarification",
  buyerCabinet.status === 200 &&
    buyerCabinet.body.toString().includes("Уточните цвет товара"),
);
check(
  "forged webhook rejected",
  (
    await request("/api/telegram/webhook", {
      method: "POST",
      body: { update_id: 1 },
    })
  ).status === 401,
);
check(
  "buyer cannot access owner delivery diagnostics",
  (await request("/api/telegram/health", { cookie: buyerCookie })).status ===
    403,
);

console.log("HTTP CHECKS PASSED:", checks);
await writeFile(
  ".demo/http-check/result.json",
  JSON.stringify({ checks, passed: checks, date: today() }),
);
await app.close();
process.exit(0);
