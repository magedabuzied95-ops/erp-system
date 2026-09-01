// The hero video sits at the very top of the storefront home, so it competes
// with the page for the first bytes of a mobile connection. The Pexels source
// was 1.66 MB; it ships trimmed and re-encoded at 236 KB. These guard the size
// budget and the four attributes without which a mobile browser refuses to
// autoplay it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const storefrontSource = readFileSync(
  new URL("../src/storefront/Storefront.jsx", import.meta.url),
  "utf8"
);

const heroVideoComponent = (() => {
  const start = storefrontSource.indexOf("function StorefrontHeroVideo()");
  assert.notEqual(start, -1, "StorefrontHeroVideo is gone from Storefront.jsx");
  const next = storefrontSource.indexOf("\nfunction ", start + 1);
  return storefrontSource.slice(start, next === -1 ? undefined : next);
})();

// 400 KB. The shipped file is 236 KB, so this catches a careless swap-in of an
// untranscoded download without failing on a re-encode that lands a little
// heavier than today's.
const HERO_VIDEO_BYTE_BUDGET = 400 * 1024;

test("the hero video stays inside its byte budget", () => {
  const bytes = statSync(new URL("../public/media/hero-walk.mp4", import.meta.url)).size;
  assert.ok(
    bytes <= HERO_VIDEO_BYTE_BUDGET,
    `public/media/hero-walk.mp4 is ${bytes} bytes, over the ${HERO_VIDEO_BYTE_BUDGET} budget`
  );
});

test("the hero video is the first thing on the home page", () => {
  const homePage = storefrontSource.slice(storefrontSource.indexOf("function PremiumHomePage"));
  const hero = homePage.indexOf("<StorefrontHeroVideo");
  const homeHero = homePage.indexOf("<HomeHero");
  assert.notEqual(hero, -1, "PremiumHomePage no longer renders the hero video");
  assert.notEqual(homeHero, -1, "PremiumHomePage no longer renders HomeHero");
  assert.ok(hero < homeHero, "the hero video must render above the rest of the home content");
});

// A mobile browser blocks autoplay for anything audible, and iOS Safari takes
// a video without playsInline fullscreen instead of playing it in place.
for (const attribute of ["autoPlay", "muted", "loop", "playsInline"]) {
  test(`the hero video keeps ${attribute}`, () => {
    assert.match(heroVideoComponent, new RegExp(`^\\s*${attribute}\\s*$`, "m"));
  });
}

test("the hero video carries no audio track", () => {
  const bytes = readFileSync(new URL("../public/media/hero-walk.mp4", import.meta.url));
  // Every audio sample entry an MP4 can name for this footage. None may appear.
  for (const codec of ["mp4a", "Opus", ".mp3", "ac-3"]) {
    assert.equal(
      bytes.includes(Buffer.from(codec, "latin1")),
      false,
      `hero-walk.mp4 still carries an ${codec} audio track`
    );
  }
});

test("the hero video restarts after the tab comes back", () => {
  assert.match(heroVideoComponent, /addEventListener\("visibilitychange"/);
  assert.match(heroVideoComponent, /document\.visibilityState !== "visible"/);
  assert.match(heroVideoComponent, /video\.play\(\)/);
});
