import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyTrafficSource,
  hasTrafficSignal,
  isBotUserAgent,
  referrerHost,
} from "../shared/trafficSource.js";

// Sales channel analytics credits each storefront order to the source of the visit it was
// placed in. These pin the classifier the storefront and the server share.

const OWN = "m1store-egy.com";
const classify = (search, referrer = "") => {
  const { channel, medium } = classifyTrafficSource({ params: search, referrer, ownHost: OWN });
  return `${channel}/${medium}`;
};

test("ad click ids are paid, whatever the referrer says", () => {
  assert.equal(classify("?gclid=abc"), "google/paid");
  assert.equal(classify("?gbraid=abc"), "google/paid");
  assert.equal(classify("?gad_source=1"), "google/paid");
  assert.equal(classify("?ttclid=abc", "https://www.tiktok.com/"), "tiktok/paid");
  assert.equal(classify("?ScCid=abc"), "snapchat/paid");
});

test("utm tags decide channel and medium", () => {
  assert.equal(classify("?utm_source=facebook&utm_medium=paid"), "facebook/paid");
  assert.equal(classify("?utm_source=fb&utm_medium=cpc"), "facebook/paid");
  assert.equal(classify("?utm_source=ig&utm_medium=social&utm_content=link_in_bio"), "instagram/organic");
  assert.equal(classify("?utm_source=tiktok&utm_medium=paid_social"), "tiktok/paid");
  assert.equal(classify("?utm_source=newsletter&utm_medium=email"), "email/organic");
  assert.equal(classify("?utm_source=someblog&utm_medium=referral"), "other/organic");
});

test("fbclid alone cannot tell an ad from a post", () => {
  assert.equal(classify("?fbclid=xyz"), "facebook/unknown");
  assert.equal(classify("?fbclid=xyz", "https://l.instagram.com/"), "instagram/unknown");
  assert.equal(classify("?utm_source=facebook&fbclid=xyz"), "facebook/unknown");
});

test("the shop's own /track links are organic posts", () => {
  assert.equal(classify("?src=instagram&campaign=summer&code=M1IG12"), "instagram/organic");
  assert.equal(classify("?src=story"), "instagram/organic");
});

test("referrers: search and social are organic, our own host is direct", () => {
  assert.equal(classify("", "https://www.google.com.eg/"), "google/organic");
  assert.equal(classify("", "android-app://com.google.android.googlequicksearchbox/"), "google/organic");
  assert.equal(classify("", "https://m.facebook.com/"), "facebook/organic");
  assert.equal(classify("", "https://www.youtube.com/watch?v=1"), "youtube/organic");
  assert.equal(classify("", "https://some-forum.example/thread"), "referral/organic");
  assert.equal(classify("", "https://www.m1store-egy.com/cart"), "direct/direct");
  assert.equal(classify("", ""), "direct/direct");
});

test("a new session only opens on a real signal", () => {
  assert.equal(hasTrafficSignal({}, "", OWN), false);
  assert.equal(hasTrafficSignal({}, "https://m1store-egy.com/p/1", OWN), false);
  assert.equal(hasTrafficSignal({ gclid: "x" }, "", OWN), true);
  assert.equal(hasTrafficSignal({}, "https://google.com/", OWN), true);
});

test("helpers", () => {
  assert.equal(referrerHost("https://www.Google.com/search?q=x"), "google.com");
  assert.equal(referrerHost("not a url"), "");
  assert.equal(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isBotUserAgent("facebookexternalhit/1.1"), true);
  assert.equal(isBotUserAgent(""), true);
  assert.equal(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), false);
});

test("checkout stamps the visit's source on website orders only", () => {
  const controller = fs.readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  assert.match(controller, /const trafficAttribution = posOnlineOrder\s*\?\s*null/);
  assert.match(controller, /\.\.\.\(trafficAttribution \|\| \{\}\),/);
  // The columns must exist before the orders column cache is warmed, or inserts drop them.
  const schemaStart = controller.indexOf("const ensureStorefrontSchemaNow");
  const warm = controller.indexOf("tableColumns(clientOrPool, \"orders\")");
  const ensure = controller.indexOf("await ensureTrafficSchema();", schemaStart);
  assert.ok(ensure > schemaStart && ensure < warm);
});
