import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const app = join(root, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
    });
}

test("retired RAJAB marketing routes and local demo backend stay removed", () => {
  const retired = [
    "src/lib/demo-db.ts",
    "src/lib/demo-ids.ts",
    "src/lib/seed.ts",
    "src/components/public-application.tsx",
    "src/components/login-form.tsx",
    "src/app/api/intake/route.ts",
  ];
  for (const path of retired)
    assert.equal(existsSync(join(root, path)), false, `${path} must stay deleted`);

  const landing = readFileSync(join(app, "app/page.tsx"), "utf8");
  const login = readFileSync(join(app, "app/login/page.tsx"), "utf8");
  assert.match(landing, /redirect\(["']\/mini["']\)/);
  assert.match(login, /redirect\(["']\/mini["']\)/);
});

test("working HESAP code must never fall back to demo authentication or storage", () => {
  for (const path of sourceFiles(app)) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /\b(?:DEMO_MODE|DEMO_DEPLOYMENT|DEMO_ACCESS_PASSWORD|rajab_demo)\b/, path);
    assert.doesNotMatch(source, /(?:from|import\s*\()\s*["'][^"']*\/demo-db["']/, path);
  }
});
