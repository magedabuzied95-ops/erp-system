import "dotenv/config";

import { reindexAiVisualProducts } from "../services/aiVisualSearchProService.js";

const tenantArg = process.argv.find((arg) => arg.startsWith("--tenant-id="));
const tenantId = tenantArg ? tenantArg.split("=").slice(1).join("=") : null;
const force = process.argv.includes("--force");

try {
  const result = await reindexAiVisualProducts({ tenantId, force });
  console.log("[ai-visual-index] reindex complete", {
    indexed: result.indexed || 0,
    embedded: result.embedded || 0,
    reused: result.reused || 0,
    skipped: result.skipped || 0,
    errors: result.errors || 0,
    embeddingProvider: result.embeddingProvider || "",
    force,
  });
  process.exit(0);
} catch (error) {
  console.error("[ai-visual-index] reindex failed", {
    message: error?.message || "Unknown error",
    code: error?.code || "",
    detail: error?.detail || "",
  });
  process.exit(1);
}
