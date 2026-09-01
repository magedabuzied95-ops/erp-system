// The hero video sits at the very top of the storefront home, so it competes
// with the page for the first bytes of a mobile connection — and it has to
// start on its own, because a background clip with a play button over it is
// not a background clip. These guard the size budget, the resolution, and the
// handful of attributes a mobile browser reads before it allows autoplay.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const storefrontSource = readFileSync(
  new URL("../src/storefront/Storefront.jsx", import.meta.url),
  "utf8"
);
const stylesheetSource = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const heroVideoPath = new URL("../public/media/hero-walk.mp4", import.meta.url);

const heroVideoComponent = (() => {
  const start = storefrontSource.indexOf("function StorefrontHeroVideo()");
  assert.notEqual(start, -1, "StorefrontHeroVideo is gone from Storefront.jsx");
  const next = storefrontSource.indexOf("\nfunction ", start + 1);
  return storefrontSource.slice(start, next === -1 ? undefined : next);
})();

// levelshoes.com — the reference for this slot — ships 2.79 MB for its mobile
// hero. Ours is 1.88 MB. The ceiling sits between the two: under what the
// reference spends, with room for a re-encode, and low enough to catch an
// untranscoded master (8.75 MB) being dropped in.
const HERO_VIDEO_BYTE_BUDGET = 2.5 * 1024 * 1024;

test("the hero video stays inside its byte budget", () => {
  const bytes = statSync(heroVideoPath).size;
  assert.ok(
    bytes <= HERO_VIDEO_BYTE_BUDGET,
    `public/media/hero-walk.mp4 is ${bytes} bytes, over the ${HERO_VIDEO_BYTE_BUDGET} budget`
  );
});

// The owner asked for 12 seconds. Longer costs roughly 165 KB a second, so a
// re-encode that quietly restores the full 24.6s master would blow the budget
// above as well — this names the intent rather than leaving it to arithmetic.
test("the hero video runs for 12 seconds", () => {
  const bytes = readFileSync(heroVideoPath);
  const mvhd = bytes.indexOf(Buffer.from("mvhd", "latin1"));
  assert.notEqual(mvhd, -1, "hero-walk.mp4 has no movie header");
  assert.equal(bytes.readUInt8(mvhd + 4), 0, "mvhd is not the 32-bit version this reader handles");
  const timescale = bytes.readUInt32BE(mvhd + 16);
  const duration = bytes.readUInt32BE(mvhd + 20);
  const seconds = duration / timescale;
  assert.ok(
    Math.abs(seconds - 12) < 0.5,
    `hero-walk.mp4 runs ${seconds.toFixed(2)}s, not the 12s asked for`
  );
});

// A 375px-wide box on a 3x phone paints 1125 device pixels. A 640-wide clip
// was shipped once and looked mushy on a real handset while being sharp in a
// still viewed at 1:1 — resolution has to be judged against device pixels.
test("the hero video is wide enough for a high-density phone", () => {
  const bytes = readFileSync(heroVideoPath);
  const tag = Buffer.from("avc1", "latin1");
  // "avc1" also shows up among the ftyp compatible brands, so walk every
  // occurrence and take the first that reads as a real VisualSampleEntry:
  // 4 tag + 6 reserved + 2 data_reference_index + 2 pre_defined + 2 reserved
  // + 12 pre_defined[3] puts the 16-bit width at +28 and height at +30.
  let dimensions = null;
  for (let at = bytes.indexOf(tag); at !== -1; at = bytes.indexOf(tag, at + 1)) {
    if (at + 32 > bytes.length) break;
    const width = bytes.readUInt16BE(at + 28);
    const height = bytes.readUInt16BE(at + 30);
    if (width > 0 && height > 0 && width <= 8192 && height <= 8192) {
      dimensions = { width, height };
      break;
    }
  }
  assert.notEqual(dimensions, null, "hero-walk.mp4 has no readable H.264 sample entry");
  assert.ok(
    dimensions.width >= 1100,
    `hero-walk.mp4 is only ${dimensions.width}x${dimensions.height}; a 3x phone needs ~1125 wide`
  );
});

// A mobile browser blocks autoplay for anything audible, and iOS Safari takes
// a video without playsInline fullscreen instead of playing it in place.
for (const attribute of ["autoPlay", "muted", "loop", "playsInline"]) {
  test(`the hero video keeps ${attribute}`, () => {
    assert.match(heroVideoComponent, new RegExp(`^\\s*${attribute}\\s*$`, "m"));
  });
}

// React assigns `muted` as a property; the autoplay check reads the attribute.
test("the hero video sets the muted attribute itself, not just the property", () => {
  assert.match(heroVideoComponent, /setAttribute\("muted", ""\)/);
});

test("the hero video never offers controls", () => {
  assert.match(heroVideoComponent, /controls=\{false\}/);
  assert.match(
    stylesheetSource,
    /sf-hero-video__media::-webkit-media-controls-start-playback-button/,
    "iOS will paint its own play button over the hero unless it is hidden"
  );
});

test("the hero video carries no audio track", () => {
  const bytes = readFileSync(heroVideoPath);
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
  assert.match(heroVideoComponent, /document\.visibilityState === "visible"/);
  assert.match(heroVideoComponent, /\.play\(\)/);
});

// Low Power Mode and data-saver refuse autoplay outright; the first tap
// anywhere is what starts it in that case.
test("the hero video starts on the first gesture when autoplay is refused", () => {
  assert.match(heroVideoComponent, /addEventListener\("pointerdown"/);
  assert.match(heroVideoComponent, /addEventListener\("touchstart"/);
});
