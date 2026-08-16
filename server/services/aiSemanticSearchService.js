/**
 * Semantic product retrieval over pgvector.
 *
 * The point: lexical search can only match words the customer happened to use. A
 * customer asking for "حاجة تناسب فرح" ("something suitable for a wedding") names no
 * brand, no model and no category, so every LIKE-based retriever returns nothing. An
 * embedding puts that phrase near formal shoes without anyone having written the rule.
 *
 * Three constraints shape this file:
 *
 * 1. It must be COMPLETELY inert when pgvector is not installed. Installing the
 *    extension needs superuser on managed Postgres and is a deliberate DBA action, so
 *    the code cannot assume it and must never fail a customer reply over it. Every
 *    entry point returns empty rather than throwing.
 *
 * 2. It NEVER decides facts. It returns candidate product rows, exactly like the
 *    lexical retrievers, and the grounding gate still has the last word on price,
 *    stock and identity. Semantic similarity is a good way to find a product and a
 *    terrible way to establish one is in stock.
 *
 * 3. Capability is detected once and cached. A per-request `SELECT FROM pg_extension`
 *    would add a round trip to every search to answer a question whose answer changes
 *    about once in the lifetime of the database.
 */
import db from "../database/db.js";
import { getSharedOpenAiClient, isTextGenerationAvailable } from "./openaiSupportService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());

/** Must match the vector width in the migration. Changing it means re-embedding. */
export const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_MODEL = () => text(process.env.AI_EMBEDDING_MODEL) || "text-embedding-3-small";

export const isSemanticSearchEnabled = () => envFlagEnabled(process.env.AI_SEMANTIC_SEARCH_ENABLED);

let capabilityPromise = null;

/**
 * Whether this database can actually serve a vector query: the extension is installed
 * AND the column exists. Both are required — a database with the extension but an
 * unapplied migration would fail on the column, which is a confusing error to hit at
 * reply time.
 */
export const detectSemanticCapability = async () => {
  if (capabilityPromise) return capabilityPromise;

  capabilityPromise = (async () => {
    try {
      const extension = await db.query("SELECT 1 FROM pg_extension WHERE extname = 'vector' LIMIT 1");
      if (!extension.rows.length) return { available: false, reason: "extension_missing" };

      const column = await db.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'embedding' LIMIT 1`
      );
      if (!column.rows.length) return { available: false, reason: "column_missing" };

      return { available: true, reason: "" };
    } catch (error) {
      // A failed probe is not a failed request: report unavailable and let the caller
      // fall back to lexical retrieval.
      return { available: false, reason: `probe_failed: ${error?.message || "unknown"}` };
    }
  })();

  return capabilityPromise;
};

/** Test seam: the capability is cached for the process lifetime. */
export const resetSemanticCapabilityCache = () => {
  capabilityPromise = null;
};

/**
 * Embeds one piece of text. Returns null rather than throwing on every failure path,
 * because every caller's fallback is "search lexically instead".
 */
export const embedText = async (value = "") => {
  const input = text(value).slice(0, 2_000);
  if (!input) return null;
  if (!isTextGenerationAvailable()) return null;

  const client = getSharedOpenAiClient();
  if (!client) return null;

  try {
    const response = await client.embeddings.create({ model: EMBEDDING_MODEL(), input });
    const vector = response?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) return null;
    return vector;
  } catch (error) {
    console.warn("[ai-semantic] embedding failed", { message: error?.message });
    return null;
  }
};

/** pgvector's literal format is a bracketed comma list, not a Postgres array. */
export const toVectorLiteral = (vector = []) => `[${asArray(vector).join(",")}]`;

/**
 * Products nearest the query, by cosine distance.
 *
 * Returns [] — never throws, never partially fails — whenever the feature is off, the
 * extension is missing, embedding fails, or the query itself errors.
 */
export const searchProductsSemantic = async ({ tenantId, query = "", limit = 8 } = {}) => {
  if (!tenantId || !text(query)) return [];
  if (!isSemanticSearchEnabled()) return [];

  const capability = await detectSemanticCapability();
  if (!capability.available) return [];

  const vector = await embedText(query);
  if (!vector) return [];

  try {
    const result = await db.query(
      `SELECT id, name, brand, price, total_stock,
              1 - (embedding <=> $2::vector) AS similarity
         FROM products
        WHERE tenant_id = $1
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $2::vector
        LIMIT $3`,
      [tenantId, toVectorLiteral(vector), Math.max(1, Math.min(50, Number(limit) || 8))]
    );
    return asArray(result.rows);
  } catch (error) {
    console.warn("[ai-semantic] query failed", { tenantId, message: error?.message });
    return [];
  }
};

/**
 * The text a product is embedded from.
 *
 * Name, brand and category only — deliberately not price or stock. Those change
 * constantly and would invalidate the embedding on every inventory movement, while
 * contributing nothing to what the product IS.
 */
export const productEmbeddingSource = (product = {}) =>
  [product.name, product.brand, product.product_type, product.category, product.description]
    .map((part) => text(part))
    .filter(Boolean)
    .join(" · ")
    .slice(0, 2_000);
