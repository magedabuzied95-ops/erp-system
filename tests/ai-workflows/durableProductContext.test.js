// Phase 12.1 — Durable grounded PRODUCT SUBJECT context. A continuation that omits the product ("طب مقاس 44؟",
// "والاسود؟", "بكام؟") reuses the most recent DETERMINISTICALLY grounded product SUBJECT for THIS session as
// CONTEXT ONLY, then re-reads stock/price/variant FRESH from ERP. Explicit new product/brand always wins.
// DB-free: the gate's impure orchestrator is exercised via injected deps (resolveProductSubject/ById +
// inventoryFacts), exactly like the existing inboxGrounding tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const G = await import("../../server/services/aiInboxGroundingGate.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const gateSrc = readFileSync(path.join(here, "../../server/services/aiInboxGroundingGate.js"), "utf8");

const SESSION = "instagram:1044077131364783";
const JORDAN39 = { id: 39, name: "Air Jordan 4  Sneakers for Men", product_type: "sneakers" };
// A durable subject pointing at #39 (as if approved/sent a moment ago), and a fresh ERP variant table.
const subjectDeps = ({ stock44 = 2, color = "Black&white", subject = { productId: "39", sourceMessageId: 634494, ageSeconds: 120, source: "approved_selection" }, row = JORDAN39 } = {}) => ({
  resolveProductSubject: async () => subject,
  resolveProductById: async () => row,
  resolveByBrandModel: async () => [], // no explicit brand/model in a bare continuation
  queryProducts: async () => [],
  inventoryFacts: async () => ({ variant_stock: [{ variant_id: 1414, size: "44", color, stock: stock44 }] }),
});
const reply = { answer: "", suggested_products: [] };

test("1+2: prior #39 + \"طب مقاس 44؟\" → #39 recalled as context, FRESH size-44 lookup → available", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "طب مقاس ٤٤؟", deps: subjectDeps({ stock44: 2 }) });
  assert.equal(r.changed, true);
  assert.notEqual(r.action, "clarify_product");
  assert.equal(r.grounding.product_resolution.source, "conversation_context");
  assert.equal(r.grounding.product_resolution.product_id, "39");
  assert.equal(r.action, "available");
  assert.equal(r.product_ambiguous, false); // §25 — never re-surface #208
});

test("3: old size-45 availability is NEVER reused — size-44 stock 0 → unavailable", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "طب مقاس ٤٤؟", deps: subjectDeps({ stock44: 0 }) });
  assert.equal(r.grounding.product_resolution.source, "conversation_context");
  assert.notEqual(r.action, "available"); // fresh ERP said 0 → must not claim available
});

test("4: prior #39 + \"والاسود؟\" → #39 context + colour from NEW message, fresh variant lookup", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "والاسود؟", deps: subjectDeps({ color: "Black" }) });
  assert.equal(r.grounding.product_resolution.source, "conversation_context");
  assert.equal(r.grounding.product_resolution.product_id, "39");
  assert.equal(r.entities.color, "black");
});

test("5: prior #39 + \"بكام؟\" → subject recalled (fresh price read downstream by enrichment)", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "بكام؟", deps: subjectDeps() });
  assert.equal(r.grounding?.product_resolution?.source, "conversation_context");
  assert.equal(r.grounding.product_resolution.product_id, "39");
});

test("6: explicit new product AFTER Jordan context → Crocs wins, context is NOT used", async () => {
  const deps = {
    resolveProductSubject: async () => ({ productId: "39", source: "approved_selection", ageSeconds: 60 }), // would be Jordan
    resolveProductById: async () => JORDAN39,
    queryProducts: async () => [{ id: 734, name: "Crocs Classic Clog", product_type: "crocs" }],
    resolveByBrandModel: async () => [],
    inventoryFacts: async () => ({ variant_stock: [{ variant_id: 90, size: "44", color: "Black", stock: 5 }] }),
  };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "طب الكروكس مقاس ٤٤؟", deps });
  // explicit "كروكس" resolves productType=crocs BEFORE the context block runs → context never consulted
  assert.notEqual(r.grounding?.product_resolution?.source, "conversation_context");
  assert.equal(r.entities.productType, "crocs");
});

test("7: no durable subject (ambiguous/unselected prior) → clarify_product, no context", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "طب مقاس ٤٤؟", deps: { ...subjectDeps(), resolveProductSubject: async () => null } });
  assert.equal(r.action, "clarify_product");
});

test("11: subject older than the recency bound → resolver returns null → clarify", async () => {
  // the resolver enforces recency in SQL; here we simulate an expired subject as a null return.
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "طب مقاس ٤٤؟", deps: { ...subjectDeps(), resolveProductSubject: async () => null } });
  assert.equal(r.action, "clarify_product");
});

test("12/13/14: no sessionId → context never consulted (no cross-conversation leakage path)", async () => {
  let called = false;
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: "", message: "طب مقاس ٤٤؟", deps: { ...subjectDeps(), resolveProductSubject: async () => { called = true; return { productId: "39" }; } } });
  assert.equal(called, false); // resolver is never invoked without a session scope
  assert.equal(r.action, "clarify_product");
});

test("18: style profile is not consulted to pick the subject (separation)", () => {
  // the context block only reads resolveProductSubject/ById; styleProfile never appears in its logic.
  const block = gateSrc.slice(gateSrc.indexOf("durable grounded PRODUCT SUBJECT continuation"), gateSrc.indexOf("const typeLabel = entities.typeLabel"));
  assert.doesNotMatch(block, /styleProfile/);
});

test("19: contextual product still performs a FRESH stock lookup (inventoryFacts invoked)", async () => {
  let invoked = 0;
  const deps = { ...subjectDeps(), inventoryFacts: async () => { invoked += 1; return { variant_stock: [{ variant_id: 1414, size: "44", color: "Black&white", stock: 2 }] }; } };
  await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "طب مقاس ٤٤؟", deps });
  assert.ok(invoked >= 1, "fresh ERP inventory must be read for the recalled product");
});

test("recency bound is an explicit, env-overridable constant (not silently widened)", () => {
  assert.ok(Number.isFinite(G.DURABLE_PRODUCT_CONTEXT_MAX_AGE_MS) && G.DURABLE_PRODUCT_CONTEXT_MAX_AGE_MS === 30 * 60 * 1000);
  assert.match(gateSrc, /AI_INBOX_PRODUCT_CONTEXT_MAX_AGE_MS/);
});

test("resolver precedence + scoping are SQL-enforced: approved correction, then sent card, session-scoped", () => {
  // Phase 15 — this predicate deliberately changed. The old NULLIF(product_id::text,'') guard let product_id=0
  // through and, because corrections are read first with LIMIT 1, the poison row won AND suppressed the sent-card
  // fallback. The contract asserted here is unchanged in spirit: precedence and scoping are still SQL-enforced.
  assert.match(gateSrc, /FROM ai_reply_corrections[\s\S]{0,800}?WHERE tenant_id = \$1 AND conversation_id = \$2\s*\n\s*AND product_id IS NOT NULL AND product_id > 0/);
  assert.match(gateSrc, /FROM ai_support_messages\s+WHERE tenant_id = \$1 AND session_id = \$2 AND message_type = 'product_card'/);
  assert.match(gateSrc, /created_at > NOW\(\) - \(\$3 \|\| ' seconds'\)::interval/);
});

test("provenance: explicit resolution is labelled source=explicit_message", async () => {
  const deps = {
    resolveByBrandModel: async () => [JORDAN39],
    resolveProductSubject: async () => { throw new Error("should not be called for an explicit product"); },
    inventoryFacts: async () => ({ variant_stock: [{ variant_id: 4105, size: "45", color: "Black", stock: 1 }] }),
  };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: SESSION, message: "عندكم جوردن فور مقاس ٤٥؟", deps });
  assert.equal(r.grounding.product_resolution.source, "explicit_message");
});
