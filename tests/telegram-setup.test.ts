import { test } from "node:test";
import assert from "node:assert/strict";
import { configureTelegram } from "../src/lib/telegram-setup";

test("webhook setup verifies bot and preserves unrelated webhooks and pending updates", async () => {
  const previous = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.TELEGRAM_MINI_APP_BOT_TOKEN = "test-token";
  process.env.APP_ORIGIN = "https://rajab.example";
  process.env.TELEGRAM_WEBHOOK_SECRET = "x".repeat(40);
  process.env.TELEGRAM_MINI_APP_BOT_USERNAME = "RajabFinance_bot";
  let username = "wrong_bot", url = "", calls: string[] = [];
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    const method = String(input).split("/").pop()!;
    calls.push(method);
    if (method === "setWebhook") {
      sentBody = JSON.parse(String(init?.body));
      url = String(sentBody.url);
    }
    return Response.json({ok:true,result:method === "getMe" ? {username} : method === "getWebhookInfo" ? {url,pending_update_count:2} : true});
  };
  try {
    await assert.rejects(configureTelegram(true), /TELEGRAM_NOT_CONFIGURED/);
    assert.deepEqual(calls,["getMe"]);
    username = "RajabFinance_bot"; url="https://other.example/hook"; calls=[];
    await assert.rejects(configureTelegram(true), /TELEGRAM_WEBHOOK_CONFLICT/);
    assert.equal(calls.includes("setWebhook"),false);
    url=""; calls=[];
    assert.equal((await configureTelegram()).connected,false);
    assert.equal(calls.includes("setWebhook"),false);
    const result=await configureTelegram(true);
    assert.equal(result.connected,true);
    assert.equal(sentBody.drop_pending_updates,false);
    assert.equal(sentBody.secret_token,"x".repeat(40));
    assert.deepEqual(sentBody.allowed_updates,["message"]);
    globalThis.fetch=async()=>{throw new Error("https://api.telegram.org/bottest-token/private");};
    await assert.rejects(configureTelegram(), e => e instanceof Error && e.message === "TELEGRAM_NOT_CONFIGURED" && !e.cause);
  } finally {
    globalThis.fetch=originalFetch;
    for(const key of ["TELEGRAM_MINI_APP_BOT_TOKEN","APP_ORIGIN","TELEGRAM_WEBHOOK_SECRET","TELEGRAM_MINI_APP_BOT_USERNAME"])
      if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
});
