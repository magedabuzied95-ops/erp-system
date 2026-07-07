import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("pos service worker excludes sensitive API routes from caching", () => {
  const swPath = path.join(process.cwd(), "public", "pos", "pos-sw.js");
  const source = fs.readFileSync(swPath, "utf8");

  assert.match(source, /startsWith\("\/api\/"\)/);
  assert.match(source, /includes\("\/orders"\)/);
  assert.match(source, /includes\("\/checkout"\)/);
  assert.match(source, /includes\("\/payments"\)/);
  assert.match(source, /includes\("\/auth"\)/);
  assert.match(source, /includes\("\/stock"\)/);
  assert.match(source, /POS_SW_NAVIGATE_FALLBACK/);
  assert.match(source, /self\.skipWaiting\(\)/);
  assert.match(source, /self\.clients\.claim\(\)/);
});

