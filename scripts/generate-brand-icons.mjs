import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../public/branding/m-one-wordmark-white.png", import.meta.url));
const outputs = [
  [fileURLToPath(new URL("../public/apple-touch-icon.png", import.meta.url)), 180],
  [fileURLToPath(new URL("../public/icons/m1-192.png", import.meta.url)), 192],
  [fileURLToPath(new URL("../public/icons/m1-512.png", import.meta.url)), 512],
  // Compatibility aliases used by installed portal/POS service workers.
  [fileURLToPath(new URL("../public/icons/employee-portal-192.png", import.meta.url)), 192],
  [fileURLToPath(new URL("../public/icons/employee-portal-512.png", import.meta.url)), 512],
  [fileURLToPath(new URL("../public/icons/pos-180.png", import.meta.url)), 180],
  [fileURLToPath(new URL("../public/icons/pos-192.png", import.meta.url)), 192],
  [fileURLToPath(new URL("../public/icons/pos-512.png", import.meta.url)), 512],
];

const iconBackground = (size) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <radialGradient id="goldGlow" cx="50%" cy="22%" r="75%">
        <stop offset="0%" stop-color="#241c0a"/>
        <stop offset="48%" stop-color="#090909"/>
        <stop offset="100%" stop-color="#000000"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="#030303"/>
    <rect width="${size}" height="${size}" fill="url(#goldGlow)" opacity="0.72"/>
  </svg>
`);

const buildIcon = async ([target, size]) => {
  const logoSize = Math.round(size * 0.78);
  const logo = await sharp(source)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp(iconBackground(size))
    .composite([
      {
        input: logo,
        left: Math.round((size - logoSize) / 2),
        top: Math.round((size - logoSize) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(target);
};

await Promise.all(outputs.map(buildIcon));

console.log("Generated M1 PWA brand icons.");
