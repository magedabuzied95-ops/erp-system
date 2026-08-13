import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// ============================================================================
// DEPLOYMENT ASSET-FALLBACK CONTRACT
// ----------------------------------------------------------------------------
// Incident: after a deployment, POS booted to a white screen with
//   "Failed to load module script ... MIME type of text/html"
//
// Root cause proven on Production:
//   GET /assets/<purged-or-missing>.js
//     -> HTTP 200
//     -> Content-Type: text/html            (the SPA catch-all served index.html)
//     -> Cache-Control: public, max-age=31536000, immutable
//
// The `headers` rule for /assets/(.*) matches the REQUEST path, so the HTML
// fallback inherited the one-year immutable asset header. Any client that ever
// requested a missing chunk then cached HTML under that .js URL for a year,
// marked immutable, so it never revalidated. Vercel's edge cached it too
// (X-Vercel-Cache: HIT). Unregistering the service worker does not clear that;
// it is the browser HTTP cache and the CDN.
//
// This file models Vercel's routing so the contract is enforced in CI:
//   - a missing hashed asset must NOT resolve to index.html
//   - a legitimate SPA deep link must still resolve to index.html
//   - HTML responses must not be cached as immutable
// ============================================================================

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

// Vercel compiles `source` with path-to-regexp, which passes regex groups
// through. This mirrors that closely enough for routing assertions.
const sourceToRegExp = (source) => {
  let pattern = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "(") {
      // Copy a balanced group verbatim so regex like ((?!assets/).*) survives.
      let depth = 1;
      let group = "(";
      i += 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "(") depth += 1;
        if (source[i] === ")") depth -= 1;
        group += source[i];
        i += 1;
      }
      pattern += group;
      continue;
    }
    if (ch === ":") {
      i += 1;
      let name = "";
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
        name += source[i];
        i += 1;
      }
      pattern += "([^/]+)";
      continue;
    }
    pattern += ch.replace(/[.*+?^${}|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp(`^${pattern}$`);
};

const matchRule = (rule, pathname) => sourceToRegExp(rule.source).exec(pathname);

/**
 * Resolve a request the way the platform actually does.
 *
 * The fall-through rule below is not an assumption -- it is the measured
 * behaviour of the deployed site. `/assets/(.*)` is rewritten to `/assets/$1`,
 * and if that self-rewrite were terminal a missing chunk would 404. Production
 * instead answers index.html:
 *
 *   GET /assets/does-not-exist-probe.js -> 200, Content-Type: text/html
 *
 * So a rewrite whose destination does not exist does NOT end routing; the
 * request keeps matching later rules and lands on the `/(.*)` catch-all. The
 * `/assets/(.*)` self-rewrite is therefore a no-op that protects nothing.
 */
const resolve = (pathname, existingFiles) => {
  if (existingFiles.has(pathname)) return { status: 200, served: pathname };

  for (const rule of config.rewrites || []) {
    const m = matchRule(rule, pathname);
    if (!m) continue;
    const destination = rule.destination.replace(/\$(\d+)/g, (_, n) => m[Number(n)] ?? "");
    if (/^https?:\/\//.test(destination)) return { status: 200, served: destination, proxied: true };
    if (existingFiles.has(destination)) return { status: 200, served: destination, viaRewrite: rule.source };
    // Destination missing -> keep matching later rules (measured behaviour).
  }
  return { status: 404, served: null };
};

const headersFor = (pathname) => {
  const out = {};
  for (const entry of config.headers || []) {
    if (!matchRule(entry, pathname)) continue;
    for (const h of entry.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
};

const FILES = new Set([
  "/index.html",
  "/assets/app-REAL123-abcdef123456.js",
  "/assets/app-REAL123-abcdef123456.css",
  "/favicon.ico",
]);

test("a missing hashed asset must not be served the SPA shell", () => {
  const missing = [
    "/assets/POSPro-PURGED01-000000000000.js",
    "/assets/app-GONE-111111111111.js",
    "/assets/vendor-OLD-222222222222.css",
  ];

  for (const req of missing) {
    const res = resolve(req, FILES);
    assert.notEqual(
      res.served,
      "/index.html",
      `${req} resolved to the SPA shell. A module request answered with HTML is exactly the ` +
        `"Failed to load module script ... MIME type of text/html" boot failure.`,
    );
    assert.equal(res.status, 404, `${req} must fail honestly so chunk-load recovery can act on it`);
  }
});

test("an existing hashed asset is still served directly", () => {
  const res = resolve("/assets/app-REAL123-abcdef123456.js", FILES);
  assert.equal(res.status, 200);
  assert.equal(res.served, "/assets/app-REAL123-abcdef123456.js");
});

test("HTML is never labelled immutable, on any path that can return HTML", () => {
  // The incident header. /assets/(.*) matched the REQUEST path, so a missing
  // chunk answered with index.html carried a one-year immutable lifetime.
  for (const req of ["/assets/POSPro-PURGED01-000000000000.js", "/assets/app-GONE-111111111111.js"]) {
    const res = resolve(req, FILES);
    if (res.served !== "/index.html") continue; // already fixed by the routing contract
    const h = headersFor(req);
    assert.doesNotMatch(
      h["cache-control"] || "",
      /immutable|max-age=31536000/,
      `${req} returns HTML with an immutable asset lifetime; clients cache HTML under a .js URL for a year`,
    );
  }
});

test("legitimate SPA deep links still reach the application shell", () => {
  const deepLinks = [
    "/pos",
    "/orders",
    "/products",
    "/admin/settings",
    "/c/some-category",
    "/shop/confirm/abc123",
    "/inbox",
    "/employee-portal",
  ];

  for (const req of deepLinks) {
    const res = resolve(req, FILES);
    assert.equal(res.served, "/index.html", `${req} must still boot the SPA`);
  }
});

test("SPA shell HTML is never given an immutable lifetime", () => {
  // Deliberately NOT asserting `no-store` here. Measured on Production, deep
  // links already answer `public, max-age=0, must-revalidate`, which forces a
  // revalidation on every load and cannot serve a stale shell silently. Only
  // `/index.html` literally carries `no-store`, and essentially nothing requests
  // that path -- every real entry point is a deep link.
  //
  // What must never happen is the incident header: shell HTML inheriting the
  // one-year immutable asset lifetime, which is what made the failure permanent.
  for (const req of ["/pos", "/orders", "/", "/admin/settings"]) {
    const res = resolve(req, FILES);
    assert.equal(res.served, "/index.html");
    const cc = headersFor(req)["cache-control"] || "";
    assert.doesNotMatch(
      cc,
      /immutable|max-age=31536000/,
      `${req} serves the app shell with an immutable lifetime; a stale shell would never revalidate`,
    );
  }
});
