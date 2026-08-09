import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const routeSource = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");

test("product-card delivery recovers the recipient from the canonical conversation key", () => {
  assert.match(routeSource, /const recipientIdFromConversationKey =/);
  assert.match(routeSource, /conversationChannel !== normalizedChannel/);
  assert.match(
    routeSource,
    /conversation\.session_id \|\| conversation\.external_conversation_id \|\| conversationId/
  );
  assert.match(routeSource, /conversation\.customer_profile\?\.psid \|\|\s*conversationRecipientId/);
});
