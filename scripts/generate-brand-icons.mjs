import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../public/favicon.svg", import.meta.url));
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

await Promise.all(
  outputs.map(([target, size]) =>
    sharp(source)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(target),
  ),
);

console.log("Generated M1 brand icons.");
