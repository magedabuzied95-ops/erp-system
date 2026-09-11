/* Proves a vision model actually reads a customer's product photo before the
 * backend is switched to it — through the exact path production uses
 * (understandProductImageForSearch), on a real photo a customer sent.
 *
 *   docker exec erp-backend node server/scripts/aiVisionProviderSmoke.js --probe
 *       lists the models on the configured server (AI_VISION_BASE_URL or
 *       AI_TEXT_BASE_URL), tries the ones that look image-capable one by one on
 *       the newest WhatsApp photo, stops at the first that reads it, and prints
 *       the env line to set.
 *   docker exec erp-backend node server/scripts/aiVisionProviderSmoke.js --list
 *   docker exec erp-backend node server/scripts/aiVisionProviderSmoke.js --model=<id> [--image=<path>]
 *
 * Default image: the newest file in ./uploads/whatsapp-media. Exit code 0 only
 * when a model returned a product type or a brand for the photo. Nothing here
 * writes settings or env — it only reads and reports. */
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

import { resolveVisionProvider } from "../services/aiVisionProviderService.js";
import { understandProductImageForSearch } from "../services/openaiSupportService.js";

const arg = (name) => {
  const hit = process.argv.find((value) => value === `--${name}` || value.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const newestWhatsappPhoto = async () => {
  const dir = path.join(process.cwd(), "uploads", "whatsapp-media");
  const names = (await fs.readdir(dir).catch(() => [])).filter((name) => MIME[path.extname(name).toLowerCase()]);
  const stats = await Promise.all(names.map(async (name) => ({ name, mtime: (await fs.stat(path.join(dir, name))).mtimeMs })));
  const newest = stats.sort((a, b) => b.mtime - a.mtime)[0];
  return newest ? path.join(dir, newest.name) : "";
};

// Names that usually mean "accepts images" on OpenAI-compatible hosts. A guess to ORDER the probe,
// never a verdict: every candidate is proven by actually sending it the photo.
const LOOKS_IMAGE_CAPABLE = /(vision|[-_/]vl\b|vl-|scout|maverick|llava|pixtral|gemma-?3|llama-?4|qwen.*vl|multimodal|omni)/i;
// Models that cannot be a vision chat model at all — speech, text-to-speech, guard classifiers,
// embeddings. Everything else is tried. The first live probe (Groq, 2026-09-11) listed 14 models,
// none of whose names looked image-capable, and so tried none: a name is not evidence either way.
const CANNOT_READ_IMAGES = /(whisper|orpheus|tts|prompt-guard|safeguard|embed|rerank|moderation|distil)/i;

const serverFor = () => {
  const origin = String(process.env.AI_VISION_BASE_URL || process.env.AI_TEXT_BASE_URL || process.env.OLLAMA_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!origin) return null;
  return {
    baseUrl: /\/v1$/i.test(origin) ? origin : `${origin}/v1`,
    apiKey: String(process.env.AI_VISION_API_KEY || process.env.AI_TEXT_API_KEY || "local").trim(),
  };
};

const listModels = async (server) => {
  const client = new OpenAI({ baseURL: server.baseUrl, apiKey: server.apiKey, maxRetries: 0, timeout: 20_000 });
  const page = await client.models.list();
  return (page?.data || []).map((model) => String(model.id || "")).filter(Boolean).sort();
};

const tryModel = async (model, image) => {
  process.env.AI_VISION_MODEL = model; // the production code reads this; set only inside this process
  const startedAt = Date.now();
  const understanding = await understandProductImageForSearch({ imageBuffer: image.buffer, mimeType: image.mimeType, requestId: `vision-smoke:${model}` });
  const detected = understanding?.detected || {};
  const readIt = Boolean(detected.product_type || detected.brand_guess || detected.model_guess);
  console.log(`\n== ${model} (${Math.round((Date.now() - startedAt) / 100) / 10}s) ${readIt ? "READ THE PHOTO" : "no reading"}`);
  if (understanding?.error) console.log("   error:", understanding.error, understanding.openai_error?.code || "", understanding.openai_error?.message || "");
  console.log("   product_type:", detected.product_type || "-", "| brand:", detected.brand_guess || "-", "| model:", detected.model_guess || detected.model_family || "-");
  console.log("   colors:", [].concat(detected.colors || detected.main_colors || []).join(", ") || "-", "| confidence:", understanding?.confidence ?? "-");
  return readIt;
};

const server = serverFor();
if (!server) {
  console.error("No AI_VISION_BASE_URL / AI_TEXT_BASE_URL configured — nothing to test against.");
  process.exit(1);
}
console.log("server:", server.baseUrl);

if (arg("list") || arg("probe")) {
  const models = await listModels(server).catch((error) => {
    console.error("could not list models:", error?.status || "", error?.message || error);
    process.exit(1);
  });
  // Likely-looking names first, then every other model that is at least a chat model.
  const likely = [
    ...models.filter((id) => LOOKS_IMAGE_CAPABLE.test(id)),
    ...models.filter((id) => !LOOKS_IMAGE_CAPABLE.test(id) && !CANNOT_READ_IMAGES.test(id)),
  ];
  console.log(`\n${models.length} models; ${likely.length} worth trying (* = name looks image-capable, - = skipped):`);
  for (const id of models) console.log(`  ${LOOKS_IMAGE_CAPABLE.test(id) ? "*" : CANNOT_READ_IMAGES.test(id) ? "-" : " "} ${id}`);
  if (arg("list")) process.exit(0);

  const imagePath = typeof arg("image") === "string" ? arg("image") : await newestWhatsappPhoto();
  if (!imagePath) {
    console.error("\nNo photo found in ./uploads/whatsapp-media — pass --image=<path>.");
    process.exit(1);
  }
  const buffer = await fs.readFile(imagePath);
  const image = { buffer, mimeType: MIME[path.extname(imagePath).toLowerCase()] || "image/jpeg" };
  console.log(`\nphoto: ${imagePath} (${buffer.length} bytes)`);
  for (const model of likely) {
    if (await tryModel(model, image)) {
      console.log(`\n✅ ${model} reads customer photos. To switch the backend to it:\n`);
      console.log(`ssh root@13.140.141.50 'printf "\\nAI_VISION_MODEL=${model}\\n" >> /opt/erp/backend/.env && cd /opt/erp && docker compose up -d --no-deps --force-recreate erp-backend'`);
      process.exit(0);
    }
  }
  console.error("\nNo listed model read the photo. Try one by name with --model=<id>.");
  process.exit(1);
}

const model = typeof arg("model") === "string" ? arg("model") : resolveVisionProvider().model;
if (!model) {
  console.error("No model: pass --model=<id>, set AI_VISION_MODEL, or run --probe.");
  process.exit(1);
}
const imagePath = typeof arg("image") === "string" ? arg("image") : await newestWhatsappPhoto();
if (!imagePath) {
  console.error("No photo found in ./uploads/whatsapp-media — pass --image=<path>.");
  process.exit(1);
}
const buffer = await fs.readFile(imagePath);
console.log(`photo: ${imagePath} (${buffer.length} bytes)`);
const ok = await tryModel(model, { buffer, mimeType: MIME[path.extname(imagePath).toLowerCase()] || "image/jpeg" });
process.exit(ok ? 0 : 1);
