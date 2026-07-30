import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("static storefront shell identifies the public website as M1 Store", () => {
  const html = fs.readFileSync("index.html", "utf8");

  assert.match(html, /<title>M1 Store<\/title>/);
  assert.match(html, /name="application-name" content="M1 Store"/);
  assert.match(html, /property="og:site_name" content="M1 Store"/);
  assert.match(html, /property="og:title" content="M1 Store"/);
  assert.doesNotMatch(html, /<title>M1 ERP<\/title>/);
});
