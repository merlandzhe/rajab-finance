import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { telegramBotUsername } from "../src/lib/telegram-config";

test("HESAP source and deployment examples use the new bot", () => {
  const files = [
    ".env.example",
    "deploy/mini.env.example",
    ".github/workflows/hesap-browser.yml",
    "playwright.config.ts",
    "scripts/smoke-auth.mjs",
    "tests/telegram-setup.test.ts",
  ];
  for (const file of files) {
    const contents = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(contents, /Hesap95bot/, file);
    assert.doesNotMatch(contents, /RajabFinance_bot/, file);
  }
});

test("new bot username is valid and follows environment configuration", () => {
  const prior = process.env.TELEGRAM_MINI_APP_BOT_USERNAME;
  try {
    process.env.TELEGRAM_MINI_APP_BOT_USERNAME = "Hesap95bot";
    assert.equal(telegramBotUsername(), "Hesap95bot");
    process.env.TELEGRAM_MINI_APP_BOT_USERNAME = "@Hesap95bot";
    assert.equal(telegramBotUsername(), "");
    process.env.TELEGRAM_MINI_APP_BOT_USERNAME = "invalid-link";
    assert.equal(telegramBotUsername(), "");
  } finally {
    if (prior === undefined)
      delete process.env.TELEGRAM_MINI_APP_BOT_USERNAME;
    else process.env.TELEGRAM_MINI_APP_BOT_USERNAME = prior;
  }
});
