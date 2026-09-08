import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildSizeRowId, parseSizeRowId, whatsappConversationId } from "../services/whatsappSalesFlowService.js";

/* ======================================================
   THE SAME SALE, ON WHATSAPP
   ------------------------------------------------------
   WhatsApp has no Meta webhook, no quick replies and no comments, so the colour → size → summary
   → confirm → address path is driven by what Evolution actually delivers: the colour carousel's
   per-card button, typed sizes (reply buttons cap at three and a shoe has five to eight), and one
   CTA-URL button for the address form.

   What this pins down:
     1. The conversation id matches the one the address link and the inbox already use.
     2. The webhook consults the flow BEFORE rewriting a colour tap into free text for the AI,
        and lets everything the flow does not own fall through untouched.
     3. A tapped colour never inherits a size — the same rule the Meta flow needed.
     4. The address submit closes a WhatsApp order through Evolution, not through Meta.
====================================================== */

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const flowSource = read("../services/whatsappSalesFlowService.js");
const gatewayRoute = read("../routes/whatsappGateway.js");
const metaService = read("../services/metaIntegrationService.js");

// ── 1. One conversation id, shared with the inbox and the address link ────────────────────────
assert.equal(whatsappConversationId("+20 101 291 3942"), "whatsapp:201012913942");
assert.equal(whatsappConversationId("01012913942"), "whatsapp:01012913942");
assert.equal(whatsappConversationId(""), "");
assert.equal(whatsappConversationId("no digits here"), "");

// ── 2. The flow gets first refusal, and only keeps what it owns ───────────────────────────────
const flowCallIndex = gatewayRoute.indexOf("handleWhatsappSalesFlow");
const colorTapIndex = gatewayRoute.indexOf('String(normalized.selectedButtonId || "").match(/^choose_color:(\\d+)$/)');
assert.ok(flowCallIndex > 0, "the webhook never calls the WhatsApp sales flow");
assert.ok(colorTapIndex > 0, "the colour-tap rewrite is gone");
assert.ok(
  flowCallIndex < colorTapIndex,
  "the flow must see a colour tap BEFORE it is rewritten into free text for the AI"
);
assert.match(
  gatewayRoute,
  /whatsappSalesFlowHandled = flowResult\?\.handled === true/,
  "only a handled result may swallow the message"
);
assert.match(
  gatewayRoute,
  /catch \(salesFlowError\)[\s\S]{0,240}whatsapp:sales-flow-failed/,
  "a broken flow must fall through to the AI, never cost the message"
);
assert.match(
  gatewayRoute,
  /if \(!normalized\.fromMe\)/,
  "the store's own outgoing messages must not drive the flow"
);

// ── 3. A tapped colour never inherits a size ──────────────────────────────────────────────────
assert.match(
  flowSource,
  /const tappedSize = text\(colorPayload\?\.size \|\| ""\);/,
  "the tapped size must come from the payload alone"
);
assert.doesNotMatch(
  flowSource,
  /colorPayload\?\.size \|\| flow\?\.selected_size/,
  "falling back to conversation state is what produced an order for a size nobody picked"
);

// ── 4. Prices follow the Phase 1 contract here too ────────────────────────────────────────────
for (const column of ["purchase_selling_price", "manual_selling_price", "manual_price_override_active"]) {
  assert.ok(
    flowSource.includes(column),
    `the WhatsApp flow must read ${column} — most of this catalogue has no price anywhere else`
  );
}

// ── 5. The address submit closes a WhatsApp order through Evolution ───────────────────────────
const completeStart = metaService.indexOf("export const completeSocialCommentOrderFromAddressRequest");
assert.ok(completeStart > 0, "the address-submit order path is gone");
const completeBody = metaService.slice(completeStart, metaService.indexOf("export const dispatchSocialCommentMessengerQuickReplySelection", completeStart));
assert.match(
  completeBody,
  /const isWhatsapp = conversationId\.startsWith\(`\$\{AI_AGENT_CHANNELS\.WHATSAPP\}:`\)/,
  "the submit path must recognise a WhatsApp conversation"
);
assert.match(
  completeBody,
  /if \(isWhatsapp\) await sendConfirmation\(successText\);/,
  "a WhatsApp customer must get the confirmation through Evolution, not through Meta"
);
assert.match(
  completeBody,
  /const config = isWhatsapp\s*\?\s*\{ tenant_id: tenantId \}/,
  "WhatsApp has no Meta config; requiring one would drop every WhatsApp order"
);

// ── 6. Sizes are a LIST, and a row identifies its variant on its own ──────────────────────────
// Reply buttons cap at three; a shoe has five to eight sizes, so buttons would silently drop the
// rest. A list holds ten. Each row id has to name the product, the colour AND the size — a bare
// "42" coming back would be exactly as ambiguous as the typed reply the list replaces.
const rowId = buildSizeRowId({ productId: 315, color: "White & Brown", size: "32" });
assert.deepEqual(parseSizeRowId(rowId), { product_id: 315, color: "White & Brown", size: "32" });
assert.ok(rowId.length <= 200, "WhatsApp caps a list row id at 200 characters");
assert.equal(parseSizeRowId("choose_color:5507"), null, "a colour tap must not parse as a size row");
assert.equal(parseSizeRowId(""), null);
// A colour with a colon in it must still round-trip.
assert.deepEqual(
  parseSizeRowId(buildSizeRowId({ productId: 7, color: "Red: Special", size: "41.5" })),
  { product_id: 7, color: "Red: Special", size: "41.5" }
);

assert.match(
  flowSource,
  /await sendChoiceListMessage\(\{/,
  "the size step must offer a list, not ask the customer to type"
);
assert.match(
  flowSource,
  /rowId: buildSizeRowId\(\{ productId, color, size \}\)/,
  "every size row must carry its own product and colour"
);
// The list is an upgrade, never a new way to lose the sale: the sizes stay in the text and a
// typed size still works.
assert.match(
  flowSource,
  /fallbackText: `\$\{bodyText\}/,
  "the list must carry a text fallback naming the sizes"
);
const gatewaySource = read("../services/whatsappGatewayService.js");
const listStart = gatewaySource.indexOf("export const sendChoiceListMessage");
assert.ok(listStart > 0, "the generic list sender is gone");
const listBody = gatewaySource.slice(listStart, listStart + 3000);
assert.match(listBody, /\.slice\(0, 10\)/, "WhatsApp caps a list at ten rows");
assert.match(
  listBody,
  /catch \(error\)[\s\S]{0,400}sendTextMessage\(/,
  "a list that will not send must still reach the customer as text"
);

// ── 7. An explicit step is never overwritten by carried-forward state ─────────────────────────
// Callers pass a spread of the previous flow to carry the rest of the state forward, and that
// object still holds the PREVIOUS step. Spreading it AFTER the explicit fields recorded the
// address step as awaiting_order_confirmation, so the submitted address found no flow waiting for
// it and no order was ever created — proven live on WhatsApp before this was fixed.
for (const [label, source] of [["whatsapp", flowSource], ["meta", metaService]]) {
  assert.match(
    source,
    /delete carried\[field\]/,
    `${label}: the flow writer must strip the explicit fields out of the carried state`
  );
  assert.doesNotMatch(
    source,
    /step: text\(step\),\r?\n\s*source: \w+,\r?\n\s*\.\.\./,
    `${label}: carried state must not be spread after the explicit fields`
  );
}

console.log("whatsapp sales flow OK");
