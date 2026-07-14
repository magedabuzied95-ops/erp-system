import assert from "node:assert/strict";
import test from "node:test";

import { extractMetaWebhookMessages } from "../server/services/aiChannelAdapterService.js";

const webhook = (messaging) => ({
  object: "page",
  entry: [{ id: "PAGE_ID", messaging: [messaging] }],
});

test("Meta inbound and page echoes resolve to the same customer conversation", async () => {
  const [inbound] = await extractMetaWebhookMessages({
    tenantId: 1,
    body: webhook({
      sender: { id: "CUSTOMER_ID" },
      recipient: { id: "PAGE_ID" },
      timestamp: 1,
      message: { mid: "inbound-mid", text: "hello" },
    }),
  });
  const [outbound] = await extractMetaWebhookMessages({
    tenantId: 1,
    body: webhook({
      sender: { id: "PAGE_ID" },
      recipient: { id: "CUSTOMER_ID" },
      timestamp: 2,
      message: { mid: "outbound-mid", text: "reply", is_echo: true },
    }),
  });

  assert.equal(inbound.external_conversation_id, "facebook_messenger:CUSTOMER_ID");
  assert.equal(inbound.direction, "inbound");
  assert.equal(inbound.sender_type, "customer");
  assert.equal(outbound.external_conversation_id, inbound.external_conversation_id);
  assert.equal(outbound.external_customer_id, "CUSTOMER_ID");
  assert.equal(outbound.direction, "outbound");
  assert.equal(outbound.from_me, true);
  assert.equal(outbound.sender_type, "staff");
});
