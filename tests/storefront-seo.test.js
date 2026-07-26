import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  STOREFRONT_ORIGIN,
  buildRobotsTxt,
  buildSitemapEntries,
  buildSitemapXml,
  createStorefrontSitemapHandler,
  storefrontRobotsHandler,
} from "../server/services/storefrontSeoService.js";

const sampleProducts = [
  {
    id: 10,
    name: "Sneaker & Runner",
    slug: "sneaker-runner",
    updated_at: "2026-07-25T10:20:30.000Z",
  },
  {
    id: 11,
    name: "حذاء <خاص>",
    slug: "حذاء-خاص",
    updated_at: null,
  },
];

test("sitemap is valid XML content and never SPA HTML", () => {
  const xml = buildSitemapXml(sampleProducts);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<\/urlset>\s*$/);
  assert.doesNotMatch(xml, /<!doctype html|<html|<script/i);
  assert.equal((xml.match(/<url>/g) || []).length, buildSitemapEntries(sampleProducts).length);
});

test("sitemap contains only canonical public URLs without queries or private paths", () => {
  const entries = buildSitemapEntries(sampleProducts);
  assert.ok(entries.some(({ loc }) => loc === `${STOREFRONT_ORIGIN}/`));
  assert.ok(entries.some(({ loc }) => loc === `${STOREFRONT_ORIGIN}/products`));
  assert.ok(entries.some(({ loc }) => loc === `${STOREFRONT_ORIGIN}/product/sneaker-runner`));
  for (const { loc } of entries) {
    const url = new URL(loc);
    assert.equal(url.origin, STOREFRONT_ORIGIN);
    assert.equal(url.search, "");
    assert.doesNotMatch(url.pathname, /^\/(?:account|cart|checkout|dashboard|orders|settings|api)(?:\/|$)/);
    assert.doesNotMatch(url.pathname, /^\/shop(?:\/|$)/);
  }
});

test("sitemap includes real lastmod and escapes XML values", () => {
  const xml = buildSitemapXml(sampleProducts);
  assert.match(xml, /<lastmod>2026-07-25T10:20:30\.000Z<\/lastmod>/);
  assert.match(xml, /%D8%AD%D8%B0%D8%A7%D8%A1-%D8%AE%D8%A7%D8%B5/);
  assert.ok((xml.match(/<lastmod>/g) || []).length >= 1);
});

test("robots allows public assets, blocks private areas, and declares sitemap", () => {
  const robots = buildRobotsTxt();
  assert.match(robots, /^User-agent: \*\nAllow: \//);
  assert.match(robots, /Disallow: \/account/);
  assert.match(robots, /Disallow: \/checkout/);
  assert.match(robots, /Disallow: \/api/);
  assert.match(robots, new RegExp(`Sitemap: ${STOREFRONT_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/sitemap\\.xml`));
  assert.doesNotMatch(robots, /Disallow: \/(?:assets|images|uploads|storefront)/);
  assert.doesNotMatch(robots, /<!doctype html|<html|<script/i);
});

const responseRecorder = () => {
  const headers = {};
  return {
    headers,
    statusCode: 0,
    body: "",
    set(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
};

test("HTTP handlers return 200 with XML/text content types instead of index.html", async () => {
  const sitemapRes = responseRecorder();
  const sitemapHandler = createStorefrontSitemapHandler({
    loadProducts: async () => sampleProducts,
  });
  await sitemapHandler({}, sitemapRes, (error) => {
    throw error;
  });
  assert.equal(sitemapRes.statusCode, 200);
  assert.match(sitemapRes.headers["content-type"], /^application\/xml/);
  assert.match(sitemapRes.body, /^<\?xml/);
  assert.doesNotMatch(sitemapRes.body, /<html|<!doctype/i);

  const robotsRes = responseRecorder();
  storefrontRobotsHandler({}, robotsRes);
  assert.equal(robotsRes.statusCode, 200);
  assert.match(robotsRes.headers["content-type"], /^text\/plain/);
  assert.match(robotsRes.body, /^User-agent:/);
  assert.doesNotMatch(robotsRes.body, /<html|<!doctype/i);
});

test("Vercel serves SEO routes before the SPA fallback", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const sources = config.rewrites.map(({ source }) => source);
  const fallbackIndex = sources.indexOf("/(.*)");
  assert.ok(sources.indexOf("/sitemap.xml") >= 0);
  assert.ok(sources.indexOf("/robots.txt") >= 0);
  assert.ok(sources.indexOf("/sitemap.xml") < fallbackIndex);
  assert.ok(sources.indexOf("/robots.txt") < fallbackIndex);
});

test("Google verification file remains unchanged", () => {
  const value = fs.readFileSync(new URL("../public/google6be0c3721d0652f8.html", import.meta.url), "utf8").trim();
  assert.equal(value, "google-site-verification: google6be0c3721d0652f8.html");
});
