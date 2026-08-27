// A reply typed inside the Facebook or Instagram app comes back to us as an echo
// of our own message. It belongs in the customer's thread, but as OURS. When the
// echo is filed as the customer's, the transcript shows the team talking to
// itself under the customer's name — and the AI answers our own words.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractMetaWebhookMessages } from "../server/services/aiChannelAdapterService.js";
import { metaSyncedMessageIsFromBusiness } from "../server/services/metaIntegrationService.js";

const IG_BUSINESS_ID = "17841400000000001";
const IG_CUSTOMER_ID = "6789000000000002";
const PAGE_ID = "1010101010101010";
const PSID = "2020202020202020";

const instagramEvent = (message) => ({
  object: "instagram",
  entry: [{ id: IG_BUSINESS_ID, time: 1756300000000, messaging: [message] }],
});

const onlyMessage = async (body) => {
  const messages = await extractMetaWebhookMessages({ body, tenantId: 1 });
  assert.equal(messages.length, 1, "expected exactly one normalized message");
  return messages[0];
};

test("an Instagram echo flagged is_echo is stored as ours, inside the customer's thread", async () => {
  const message = await onlyMessage(instagramEvent({
    sender: { id: IG_BUSINESS_ID },
    recipient: { id: IG_CUSTOMER_ID },
    timestamp: 1756300000000,
    message: { mid: "mid.echo-flagged", text: "صباح النور", is_echo: true },
  }));

  assert.equal(message.from_me, true);
  assert.equal(message.direction, "outbound");
  assert.equal(message.sender_type, "staff");
  assert.equal(message.external_customer_id, IG_CUSTOMER_ID);
  assert.equal(message.external_conversation_id, `instagram:${IG_CUSTOMER_ID}`);
});

test("an Instagram echo with no is_echo flag is still ours when the sender IS the business account", async () => {
  // Instagram does not always set is_echo on a reply sent from the phone app.
  // The sender id alone settles it: entry.id is the business account.
  const message = await onlyMessage(instagramEvent({
    sender: { id: IG_BUSINESS_ID },
    recipient: { id: IG_CUSTOMER_ID },
    timestamp: 1756300100000,
    message: { mid: "mid.echo-unflagged", text: "هو اتشحن غاليا السبت ان شاء الله" },
  }));

  assert.equal(message.from_me, true);
  assert.equal(message.direction, "outbound");
  assert.equal(message.sender_type, "staff");
  assert.equal(message.external_conversation_id, `instagram:${IG_CUSTOMER_ID}`);
});

test("a real Instagram customer message is still inbound", async () => {
  const message = await onlyMessage(instagramEvent({
    sender: { id: IG_CUSTOMER_ID },
    recipient: { id: IG_BUSINESS_ID },
    timestamp: 1756300200000,
    message: { mid: "mid.inbound", text: "ممكن اعرف الاوردر هيوصل امتى" },
  }));

  assert.equal(message.from_me, false);
  assert.equal(message.direction, "inbound");
  assert.equal(message.sender_type, "customer");
  assert.equal(message.external_conversation_id, `instagram:${IG_CUSTOMER_ID}`);
});

test("a Messenger echo keeps its outbound direction", async () => {
  const message = await onlyMessage({
    object: "page",
    entry: [{
      id: PAGE_ID,
      time: 1756300300000,
      messaging: [{
        sender: { id: PAGE_ID },
        recipient: { id: PSID },
        timestamp: 1756300300000,
        message: { mid: "mid.messenger-echo", text: "تمام، هيتشحن النهاردة", is_echo: true },
      }],
    }],
  });

  assert.equal(message.from_me, true);
  assert.equal(message.sender_type, "staff");
  assert.equal(message.external_conversation_id, `facebook_messenger:${PSID}`);
});

test("history sync reads a business sender from the thread, not only from the stored id list", () => {
  const businessIds = new Set([PAGE_ID]); // no instagram_business_account_id stored

  assert.equal(
    metaSyncedMessageIsFromBusiness({ fromId: IG_BUSINESS_ID, businessIds, customerExternalId: IG_CUSTOMER_ID }),
    true,
    "the only other participant in a DM thread is us"
  );
  assert.equal(
    metaSyncedMessageIsFromBusiness({ fromId: IG_CUSTOMER_ID, businessIds, customerExternalId: IG_CUSTOMER_ID }),
    false
  );
  assert.equal(
    metaSyncedMessageIsFromBusiness({ fromId: PAGE_ID, businessIds, customerExternalId: "" }),
    true,
    "a stored business id still counts on its own"
  );
  assert.equal(
    metaSyncedMessageIsFromBusiness({ fromId: "", businessIds, customerExternalId: IG_CUSTOMER_ID }),
    false,
    "an unknown sender is never guessed into a direction"
  );
});

test("the production Meta webhook routes an echo away from the inbound writer", () => {
  // logIncomingToInbox hardcodes sender_type 'customer'. Reaching it with an echo
  // is the defect itself, so the branch that diverts one must stay ahead of it.
  const source = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "services", "metaIntegrationService.js"),
    "utf8"
  );
  const echoBranch = source.indexOf('if (message.from_me === true || text(message.direction) === "outbound")');
  const inboundWriter = source.indexOf("await logIncomingToInbox({ message, config })");

  assert.ok(echoBranch > 0, "processMetaWebhook must branch on from_me/outbound before writing the row");
  assert.ok(inboundWriter > 0, "expected the inbound writer call to still exist");
  assert.ok(echoBranch < inboundWriter, "the echo branch must run before logIncomingToInbox");
  assert.ok(
    source.includes("appendChannelOutboundSupportReply"),
    "the echo must be persisted through the outbound transcript writer"
  );
});
