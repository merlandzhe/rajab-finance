import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOrigin } from "../src/lib/origin-guard";

function postFrom(origin?: string) {
  return new Request("https://hesap-mini-app.vercel.app/api/auth/telegram", {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });
}

test("Telegram registration accepts both verified HESAP domains on Vercel", () => {
  const prev = { VERCEL: process.env.VERCEL, APP_ORIGIN: process.env.APP_ORIGIN };
  try {
    process.env.VERCEL = "1";
    process.env.APP_ORIGIN = "https://hesap-mini-app.vercel.app";
    assert.doesNotThrow(() => assertOrigin(postFrom("https://hesap-mini-app.vercel.app")));
    assert.doesNotThrow(() => assertOrigin(postFrom("https://rajab-finance-mini.vercel.app")));
    for (const untrusted of [undefined, "null", "https://evil.vercel.app", "https://hesap-mini-app.vercel.app.evil.com", "http://hesap-mini-app.vercel.app"]) {
      assert.throws(() => assertOrigin(postFrom(untrusted)), /INVALID_ORIGIN/);
    }
  } finally {
    if (prev.VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev.VERCEL;
    if (prev.APP_ORIGIN === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = prev.APP_ORIGIN;
  }
});

test("local/non-Vercel deployments accept only the configured origin", () => {
  const prev = { VERCEL: process.env.VERCEL, APP_ORIGIN: process.env.APP_ORIGIN };
  try {
    delete process.env.VERCEL;
    process.env.APP_ORIGIN = "http://127.0.0.1:3000";
    assert.doesNotThrow(() => assertOrigin(postFrom("http://127.0.0.1:3000")));
    assert.throws(() => assertOrigin(postFrom("https://hesap-mini-app.vercel.app")), /INVALID_ORIGIN/);
  } finally {
    if (prev.VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev.VERCEL;
    if (prev.APP_ORIGIN === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = prev.APP_ORIGIN;
  }
});
