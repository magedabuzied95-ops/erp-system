import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

/**
 * The owner's rule (2026-10-19): everything a customer sees in a chat runs on OpenAI; the free
 * Groq day budget stays for the storefront's photo search and the product-content jobs. Live,
 * a WhatsApp photo hit Groq's daily cap and the customer got a generic line.
 *
 * One local server plays both providers and records which one each photo went to.
 */

const UNDERSTANDING = {
  product_type: "sneaker", brand_guess: "Nike", model_family: "Air Force 1", model_guess: "Air Force 1",
  shoe_type: "low", colors: ["white"], secondary_colors: [], materials: ["leather"], sole_shape: "flat",
  logo_text: "", logo_position: "", silhouette: "low", category: "sneakers", gender_style: "unisex",
  features: [], notable_features: [], english_keywords: ["air force"], arabic_keywords: ["ايرفورس"],
  field_confidence: {
    product_type: 1, brand_guess: 1, model_family: 1, model_guess: 1, shoe_type: 1, colors: 1, materials: 1,
    sole_shape: 1, logo_text: 1, logo_position: 1, silhouette: 1, category: 1, gender_style: 1, features: 1,
  },
  confidence: 0.9,
};

const hits = [];
let openAiStatus = 200;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/openai/")) {
      hits.push("openai");
      if (openAiStatus !== 200) {
        res.statusCode = openAiStatus;
        res.end(JSON.stringify({ error: { message: "You have no credits remaining.", type: "insufficient_quota" } }));
        return;
      }
      res.end(JSON.stringify({
        id: "resp_1", object: "response", status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(UNDERSTANDING) }] }],
      }));
      return;
    }
    hits.push("groq");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(UNDERSTANDING) } }] }));
  });
});

const IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

test("chat photos go to OpenAI first; the storefront keeps Groq; Groq is the chat fallback", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    OPENAI_BASE_URL: `${origin}/openai/v1`,
    OPENAI_API_KEY: "test-key",
    AI_SUPPORT_ENABLED: "true",
    AI_VISION_MODEL: "qwen/test-vision",
    AI_VISION_BASE_URL: `${origin}/groq/v1`,
    AI_VISION_API_KEY: "groq-key",
    OPENAI_VISION_MODEL: "gpt-4o-mini",
    OPENAI_VISION_FALLBACK_MODEL: "gpt-4o",
  });
  const { understandProductImageForSearch, noteOpenAiSuccess } = await import("../../server/services/openaiSupportService.js");

  hits.length = 0;
  await understandProductImageForSearch({ imageBuffer: IMAGE, mimeType: "image/png", chat: true });
  assert.deepEqual(hits, ["openai"], "a chat photo is read by OpenAI");

  hits.length = 0;
  await understandProductImageForSearch({ imageBuffer: IMAGE, mimeType: "image/png" });
  assert.deepEqual(hits, ["groq"], "the storefront's photo search stays on Groq");

  hits.length = 0;
  openAiStatus = 429;
  await understandProductImageForSearch({ imageBuffer: IMAGE, mimeType: "image/png", chat: true });
  assert.deepEqual(hits, ["openai", "groq"], "no OpenAI credit: one dead call (not two models), then Groq");
  openAiStatus = 200;
  noteOpenAiSuccess();
});
