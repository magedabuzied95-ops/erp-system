/* Prints what the configured text provider writes for one sample product, so
 * a model can be judged before merchants see it.
 *
 *   docker compose exec backend node server/scripts/aiTextProviderSmoke.js
 *   AI_TEXT_MODEL=qwen2.5:7b node server/scripts/aiTextProviderSmoke.js
 *
 * Reads the same env the backend reads (AI_TEXT_PROVIDER, AI_TEXT_BASE_URL,
 * AI_TEXT_MODEL, AI_TEXT_TIMEOUT_MS). Exit code 1 when the provider could not
 * answer and every result came from the local fallback. */
import "dotenv/config";
import {
  generateProductDescription,
  generateProductSeoMetadata,
  generateSocialPublisherCaption,
  resolveTextProvider,
} from "../services/openaiProductDescriptionService.js";

const sample = {
  product_name: process.argv[2] || "Puma Sneakers",
  brand: process.argv[3] || "Puma",
  productType: "sneakers",
  category: "Sneakers",
  gender: process.argv[4] || "women",
  colors: ["Black & Grey", "Brown", "Grey & White"],
  sizes: ["37", "38", "39", "40", "41"],
};

const provider = resolveTextProvider();
console.log("provider:", provider.kind === "none" ? "none (templates only)" : `${provider.label} ${provider.model} @ ${provider.baseUrl || "api.openai.com"}`);

const timed = async (label, run) => {
  const startedAt = Date.now();
  const result = await run();
  console.log(`\n== ${label} (${Math.round((Date.now() - startedAt) / 100) / 10}s, source ${result.source}${result.error ? `, error: ${result.error}` : ""})`);
  return result;
};

const description = await timed("description", () => generateProductDescription({ target: "all", current: sample }));
console.log("AR:", description.arabic_description);
console.log("EN:", description.english_description);

const seo = await timed("seo", () => generateProductSeoMetadata({ current: sample }));
console.log("title:", seo.meta_title, `(${seo.meta_title.length})`);
console.log("description:", seo.meta_description, `(${seo.meta_description.length})`);
console.log("keywords:", seo.keywords.join(" | "));
console.log("slug:", seo.slug);

const caption = await timed("social caption", () =>
  generateSocialPublisherCaption({ current: { ...sample, available_colors: sample.colors, available_sizes: sample.sizes, current_price: "1250", stock_quantity: "12" } })
);
console.log(caption.caption || `${caption.hook}\n${caption.body}\n${caption.cta}`);

const allFallback = [description, seo, caption].every((result) => result.source === "LOCAL_FALLBACK");
if (provider.kind !== "none" && allFallback) {
  console.error("\nThe provider is configured but never answered; check the base URL, the model name (ollama pull ...) and the timeout.");
  process.exit(1);
}
