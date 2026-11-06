import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnregisteredFile } from "../src/lib/storage-cleanup";

test("unregistered upload is removed after confirmed metadata miss", async () => {
  let removed = 0;
  assert.equal(
    await cleanupUnregisteredFile(async () => false, async () => { removed++; }),
    true,
  );
  assert.equal(removed, 1);
});

test("registered document is never removed, even if the RPC response failed", async () => {
  let removed = 0;
  assert.equal(
    await cleanupUnregisteredFile(async () => true, async () => { removed++; }),
    false,
  );
  assert.equal(removed, 0);
});

test("database lookup error fails closed without deleting a file", async () => {
  let removed = 0;
  assert.equal(
    await cleanupUnregisteredFile(
      async () => { throw new Error("database temporarily unavailable"); },
      async () => { removed++; },
    ),
    false,
  );
  assert.equal(removed, 0);
});

test("storage deletion errors do not mask the original metadata error", async () => {
  assert.equal(
    await cleanupUnregisteredFile(
      async () => false,
      async () => { throw new Error("storage unavailable"); },
    ),
    false,
  );
});
