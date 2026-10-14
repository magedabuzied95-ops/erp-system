import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The wholesale copy is the same frontend build on jomla.m1store-egy.com. In production
// the API origin is chosen by host, so that host must talk to api-jomla, and every other
// host keeps the retail API.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("jomla host maps to the wholesale API, everything else stays on retail", () => {
  const src = read("../src/shared/constants/app.js");
  assert.match(src, /"jomla\.m1store-egy\.com":\s*"https:\/\/api-jomla\.m1store-egy\.com"/);
  assert.match(src, /PRODUCTION_API_ORIGIN_BY_HOST\[[^\]]*hostname[^\]]*\]\)\s*\|\|\s*RETAIL_API_ORIGIN/);
  assert.match(src, /const PRODUCTION_API_BASE_URL = `\$\{PRODUCTION_API_ORIGIN\}\/api`/);
});

test("wholesale scripts never rebuild or restart the retail stack", () => {
  for (const file of ["setup-wholesale.sh", "deploy-wholesale.sh"]) {
    const script = read(`../ops/wholesale/${file}`);
    assert.doesNotMatch(script, /compose[^\n]*\berp-backend\b/, `${file} must not drive erp-backend`);
    assert.doesNotMatch(script, /DROP DATABASE/i, `${file} must not drop databases`);
  }
  const compose = read("../ops/wholesale/docker-compose.wholesale.yml");
  assert.match(compose, /127\.0\.0\.1:8001:8000/);
  assert.match(compose, /container_name: erp-wholesale-redis/);
});
