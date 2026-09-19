/* Proves a vision model actually reads a transfer receipt — the sender's InstaPay address
 * above all — before anything depends on it, through the exact prompt production uses.
 *
 *   docker exec erp-backend node server/scripts/paymentReceiptVisionSmoke.js
 *       reads the newest uploaded payment proof (./uploads/payment-proofs).
 *   docker exec erp-backend node server/scripts/paymentReceiptVisionSmoke.js --image=<path>
 *       reads any picture, including a camera photo of another phone's screen.
 *   docker exec erp-backend node server/scripts/paymentReceiptVisionSmoke.js --model=<id>
 *       tries one model without changing any env.
 *
 * Exit code 0 only when an InstaPay address came back, because an address is the whole point:
 * without it the notification has nothing to recognise the customer by. Writes nothing. */
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import { openAiVisionProvider, readReceiptImage, receiptVisionProvider } from "../modules/walletTransfers/paymentReceiptVision.js";

const arg = (name) => {
  const found = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : "";
};

const newestProof = async () => {
  const dir = path.join(process.cwd(), "uploads", "payment-proofs");
  const entries = await fs.readdir(dir).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
      .map(async (name) => {
        const full = path.join(dir, name);
        return { full, at: (await fs.stat(full)).mtimeMs };
      })
  );
  return files.sort((a, b) => b.at - a.at)[0]?.full || "";
};

const main = async () => {
  // --openai proves the fallback while the shared day budget on the compatible server is spent.
  const openai = process.argv.includes("--openai");
  const provider = openai ? openAiVisionProvider(process.env, arg("model")) : receiptVisionProvider();
  if (!provider) {
    console.error("No vision model configured. Set AI_VISION_MODEL (+ AI_VISION_BASE_URL / AI_TEXT_BASE_URL) or OPENAI_VISION_MODEL.");
    console.error("PAYMENT_RECEIPT_VISION=off also switches receipt reading off entirely.");
    process.exit(2);
  }
  const model = arg("model");
  const using = model ? { ...provider, model } : provider;
  const image = arg("image") || (await newestProof());
  if (!image) {
    console.error("No picture to read. Pass --image=<path>, or upload a payment proof first.");
    process.exit(2);
  }

  console.log(`model: ${using.model}`);
  console.log(`image: ${image}`);
  const started = Date.now();
  let receipt = null;
  try {
    receipt = await readReceiptImage({ diskPath: image, provider: using });
  } catch (error) {
    console.error(`FAILED after ${Date.now() - started}ms: ${error?.status ? `http_${error.status} ` : ""}${error?.message || String(error)}`);
    process.exit(1);
  }
  console.log(`read in ${Date.now() - started}ms:`, JSON.stringify(receipt, null, 2));
  if (!receipt?.senderAddress) {
    console.error("No sender address was read — this model cannot carry the receipt path on this picture.");
    process.exit(1);
  }
  console.log(`OK — sender address: ${receipt.senderAddress}`);
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
