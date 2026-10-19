/**
 * Turn a clean stocked product photo into what a customer actually sends: a phone screenshot of
 * someone's post. Random crop and zoom, a slight tilt, a busy background, a caption bar, a price
 * sticker, a phone status/nav border, JPEG damage.
 *
 * Deterministic: the same source bytes + the same seed give the same picture, so a manifest entry
 * ({ source, augment: { seed } }) IS the image — nothing has to be stored or committed.
 */
import sharp from "sharp";

// mulberry32: tiny seeded PRNG, enough for picking crop boxes and colours reproducibly.
export const seededRandom = (seed = 1) => {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const between = (rand, min, max) => min + (max - min) * rand();
const intBetween = (rand, min, max) => Math.floor(between(rand, min, max + 1));
const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];
const hsl = (h, s, l) => `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(l)}%)`;
const escapeXml = (value = "") => String(value).replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]);

// Latin only: the container's fonts may not shape Arabic, and a box of tofu is not what customers send.
const CAPTIONS = [
  "NEW ARRIVAL", "AVAILABLE NOW", "SIZES 40-45", "ORIGINAL", "BEST SELLER", "LIMITED STOCK",
  "FREE DELIVERY", "SUMMER 2026", "TOP QUALITY", "DM TO ORDER", "IN STOCK", "HOT DROP",
];
const PRICES = ["850 LE", "999 LE", "1,250 EGP", "1499", "2,100 LE", "650 EGP", "1,850", "750 LE"];
const HANDLES = ["sneakers.eg", "shoes_store", "kicks_cairo", "the.sneaker.box", "outlet_eg", "step_up"];

const busyBackgroundSvg = ({ width, height, rand }) => {
  const baseHue = between(rand, 0, 360);
  const shapes = [];
  for (let i = 0; i < intBetween(rand, 14, 30); i += 1) {
    const hue = (baseHue + between(rand, -80, 80) + 360) % 360;
    const fill = hsl(hue, between(rand, 20, 70), between(rand, 30, 85));
    const opacity = between(rand, 0.25, 0.9).toFixed(2);
    if (rand() < 0.5) {
      shapes.push(`<rect x="${intBetween(rand, -100, width)}" y="${intBetween(rand, -100, height)}" width="${intBetween(rand, 40, width / 2)}" height="${intBetween(rand, 40, height / 3)}" fill="${fill}" fill-opacity="${opacity}" transform="rotate(${intBetween(rand, -30, 30)})"/>`);
    } else {
      shapes.push(`<circle cx="${intBetween(rand, 0, width)}" cy="${intBetween(rand, 0, height)}" r="${intBetween(rand, 20, width / 4)}" fill="${fill}" fill-opacity="${opacity}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${hsl(baseHue, 40, 75)}"/><stop offset="1" stop-color="${hsl((baseHue + 60) % 360, 45, 35)}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${shapes.join("")}
  </svg>`;
};

const overlaySvg = ({ width, height, rand, phone, captionTop, caption, price, handle, postHeader }) => {
  const parts = [];
  const statusH = phone ? Math.round(height * 0.035) : 0;
  const navH = phone ? Math.round(height * 0.05) : 0;
  if (phone) {
    parts.push(`<rect x="0" y="0" width="${width}" height="${statusH}" fill="#000"/>`);
    parts.push(`<text x="${Math.round(width * 0.05)}" y="${Math.round(statusH * 0.72)}" font-family="sans-serif" font-size="${Math.round(statusH * 0.6)}" fill="#fff">${intBetween(rand, 1, 12)}:${String(intBetween(rand, 0, 59)).padStart(2, "0")}</text>`);
    parts.push(`<rect x="${Math.round(width * 0.86)}" y="${Math.round(statusH * 0.3)}" width="${Math.round(width * 0.07)}" height="${Math.round(statusH * 0.45)}" rx="3" fill="none" stroke="#fff" stroke-width="2"/>`);
    parts.push(`<rect x="${Math.round(width * 0.86) + 3}" y="${Math.round(statusH * 0.3) + 3}" width="${Math.round(width * 0.07 * between(rand, 0.2, 0.9))}" height="${Math.round(statusH * 0.45) - 6}" fill="#fff"/>`);
    parts.push(`<rect x="0" y="${height - navH}" width="${width}" height="${navH}" fill="#111"/>`);
    parts.push(`<rect x="${Math.round(width * 0.38)}" y="${height - Math.round(navH * 0.4)}" width="${Math.round(width * 0.24)}" height="5" rx="2" fill="#ddd"/>`);
  }
  if (postHeader) {
    const y = statusH;
    const h = Math.round(height * 0.06);
    parts.push(`<rect x="0" y="${y}" width="${width}" height="${h}" fill="#fff"/>`);
    parts.push(`<circle cx="${Math.round(h * 0.6)}" cy="${y + h / 2}" r="${Math.round(h * 0.32)}" fill="${hsl(between(rand, 0, 360), 60, 50)}"/>`);
    parts.push(`<text x="${Math.round(h * 1.1)}" y="${Math.round(y + h * 0.62)}" font-family="sans-serif" font-weight="bold" font-size="${Math.round(h * 0.34)}" fill="#111">${escapeXml(handle)}</text>`);
  }
  const barH = Math.round(height * between(rand, 0.06, 0.1));
  const barY = captionTop ? statusH + (postHeader ? Math.round(height * 0.06) : 0) : height - navH - barH;
  parts.push(`<rect x="0" y="${barY}" width="${width}" height="${barH}" fill="${pick(rand, ["#000", "#c00", "#111", "#f5c518", "#fff"])}" fill-opacity="${between(rand, 0.6, 0.95).toFixed(2)}"/>`);
  parts.push(`<text x="${width / 2}" y="${Math.round(barY + barH * 0.66)}" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.5)}" fill="${pick(rand, ["#fff", "#ff0", "#0f0"])}" stroke="#000" stroke-width="1">${escapeXml(caption)}</text>`);
  // Price sticker, somewhere on the picture but off the bar.
  const r = Math.round(width * between(rand, 0.08, 0.13));
  const cx = intBetween(rand, r + 10, width - r - 10);
  const cy = intBetween(rand, Math.round(height * 0.25), Math.round(height * 0.7));
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${pick(rand, ["#e11", "#f80", "#1a1", "#fd0"])}" stroke="#fff" stroke-width="4"/>`);
  parts.push(`<text x="${cx}" y="${cy + Math.round(r * 0.15)}" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="${Math.round(r * 0.42)}" fill="#fff">${escapeXml(price)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
};

/**
 * @returns {Promise<{ buffer: Buffer, mimeType: "image/jpeg", params: object }>}
 */
export const screenshotLike = async (sourceBuffer, { seed = 1 } = {}) => {
  const rand = seededRandom(seed);
  const base = sharp(sourceBuffer, { animated: false }).rotate().flatten({ background: "#ffffff" });
  const meta = await base.metadata();
  const srcW = meta.width || 800;
  const srcH = meta.height || 800;

  // Crop + zoom: keep 62-95% of each side, anywhere in the frame (the shoe may be cut at an edge).
  const keepW = between(rand, 0.62, 0.95);
  const keepH = between(rand, 0.62, 0.95);
  const cropW = Math.max(32, Math.round(srcW * keepW));
  const cropH = Math.max(32, Math.round(srcH * keepH));
  const left = intBetween(rand, 0, srcW - cropW);
  const top = intBetween(rand, 0, srcH - cropH);

  const phone = rand() < 0.75;
  const width = phone ? 1080 : pick(rand, [1080, 1200, 960]);
  const height = phone ? pick(rand, [1920, 2340, 2160]) : pick(rand, [1080, 1350, 1200]);
  const shoeWidth = Math.round(width * between(rand, 0.55, 0.95));
  const angle = between(rand, -7, 7);
  const background = await sharp(Buffer.from(busyBackgroundSvg({ width, height, rand }))).png().toBuffer();

  const rotated = await sharp(await base.extract({ left, top, width: cropW, height: cropH }).toBuffer())
    .resize({ width: shoeWidth, height: Math.round(height * 0.62), fit: "inside" })
    .rotate(angle, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();
  // Rotation grows the box: shrink it back inside the canvas, or composite refuses it.
  const shoe = await sharp(rotated)
    .resize({ width: width, height: Math.round(height * 0.76), fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const shoeLeft = intBetween(rand, 0, Math.max(0, width - shoe.info.width));
  const shoeTop = intBetween(rand, Math.round(height * 0.12), Math.max(Math.round(height * 0.12), height - shoe.info.height - Math.round(height * 0.12)));

  const overlayParams = {
    width,
    height,
    rand,
    phone,
    captionTop: rand() < 0.5,
    caption: pick(rand, CAPTIONS),
    price: pick(rand, PRICES),
    handle: pick(rand, HANDLES),
    postHeader: rand() < 0.5,
  };
  const overlay = Buffer.from(overlaySvg(overlayParams));

  const quality = intBetween(rand, 30, 70);
  let buffer = await sharp(background)
    .composite([{ input: shoe.data, left: shoeLeft, top: Math.min(shoeTop, Math.max(0, height - shoe.info.height)) }, { input: overlay, left: 0, top: 0 }])
    .jpeg({ quality })
    .toBuffer();
  // WhatsApp recompresses what it forwards: shrink and re-encode once more.
  const sentWidth = pick(rand, [720, 800, 960, 1080]);
  buffer = await sharp(buffer).resize({ width: sentWidth }).jpeg({ quality: intBetween(rand, 40, 75) }).toBuffer();

  return {
    buffer,
    mimeType: "image/jpeg",
    params: {
      seed,
      crop: { left, top, width: cropW, height: cropH, of: { width: srcW, height: srcH } },
      angle: Math.round(angle * 10) / 10,
      canvas: { width, height, phone },
      caption: overlayParams.caption,
      price: overlayParams.price,
      post_header: overlayParams.postHeader,
      first_quality: quality,
      sent_width: sentWidth,
    },
  };
};

export default screenshotLike;
