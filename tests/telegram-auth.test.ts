import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyTelegramInitData } from "../src/lib/telegram-init";
import { establishTelegramSession } from "../src/lib/telegram-session";
const botToken = "123456789:test-only-not-a-real-token";
const now = 1800000000;
function signed(fields: Record<string, string> = {}, token = botToken) {
  const p = new URLSearchParams({
    auth_date: String(now),
    user: JSON.stringify({ id: 4500000000000, first_name: "Тест" }),
    ...fields,
  });
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const check = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  p.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
}
test("Telegram signature verifies 52-bit user IDs and includes the signature field", () => {
  const raw = signed({
    signature: "telegram-ed25519-field",
    start_param: "invite_" + "x".repeat(43),
  });
  const result = verifyTelegramInitData(raw, botToken, now);
  assert.equal(result.telegramId, 4500000000000);
  assert.equal(result.invite, "x".repeat(43));
  assert.equal(
    verifyTelegramInitData(raw.split("&").reverse().join("&"), botToken, now)
      .digest,
    result.digest,
  );
  assert.throws(() =>
    verifyTelegramInitData(
      raw.replace("telegram-ed25519-field", "forged"),
      botToken,
      now,
    ),
  );
});
test("Telegram rejects another bot, tampered user, duplicate keys, malformed hash and stale/future launches", () => {
  const raw = signed();
  for (const bad of [
    raw.replace("4500000000000", "4500000000001"),
    raw + "&user=%7B%7D",
    raw + "&hash=" + "a".repeat(64),
    raw.replace(/hash=[^&]+/, "hash=zzz"),
    "",
  ]) {
    assert.throws(() => verifyTelegramInitData(bad, botToken, now));
  }
  assert.throws(() => verifyTelegramInitData(raw, "another-bot", now));
  assert.throws(
    () => verifyTelegramInitData(raw, botToken, now + 301),
    /EXPIRED/,
  );
  assert.throws(
    () => verifyTelegramInitData(raw, botToken, now - 31),
    /EXPIRED/,
  );
  for (const user of [
    { id: -1 },
    { id: "123" },
    { id: 1.5 },
    { id: 1, is_bot: true },
    null,
  ]) {
    assert.throws(() =>
      verifyTelegramInitData(
        signed({ user: JSON.stringify(user) }),
        botToken,
        now,
      ),
    );
  }
  assert.throws(() =>
    verifyTelegramInitData(signed({ auth_date: "1e9" }), botToken, now),
  );
});

function authDouble(
  options: {
    generatedId?: string;
    verifiedId?: string;
    role?: string | null;
    inactive?: boolean;
  } = {},
) {
  let verified = 0,
    signedOut = 0;
  const admin = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { id: "expected", email: "test@example.invalid" } },
          error: null,
        }),
        generateLink: async () => ({
          data: {
            user: { id: options.generatedId ?? "expected" },
            properties: { hashed_token: "server-only-hash" },
          },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient;
  const client = {
    auth: {
      verifyOtp: async (params: unknown) => {
        assert.deepEqual(params, {
          type: "email",
          token_hash: "server-only-hash",
        });
        verified++;
        return {
          data: { user: { id: options.verifiedId ?? "expected" }, session: {} },
          error: null,
        };
      },
      signOut: async () => {
        signedOut++;
      },
    },
    rpc: async () => ({
      data: {
        user_id: "expected",
        role: options.inactive ? null : (options.role ?? "client"),
        tenant_id: "tenant",
        platform_admin: false,
      },
      error: null,
    }),
  } as unknown as SupabaseClient;
  return { admin, client, counters: () => ({ verified, signedOut }) };
}
test("Telegram exchange keeps user sessions and routes by the database role", async () => {
  for (const [role, path] of [
    ["client", "/cabinet"],
    ["owner", "/crm"],
  ]) {
    const x = authDouble({ role });
    assert.equal(
      await establishTelegramSession("expected", x.admin, x.client),
      path,
    );
  }
});
test("email race cannot sign in another Auth user; inactive/mismatched sessions are removed", async () => {
  const race = authDouble({ generatedId: "wrong" });
  await assert.rejects(
    establishTelegramSession("expected", race.admin, race.client),
  );
  assert.equal(race.counters().verified, 0);
  for (const options of [{ verifiedId: "wrong" }, { inactive: true }]) {
    const x = authDouble(options);
    await assert.rejects(
      establishTelegramSession("expected", x.admin, x.client),
    );
    assert.equal(x.counters().signedOut, 1);
  }
});
