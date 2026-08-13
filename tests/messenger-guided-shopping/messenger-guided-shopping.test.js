import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMessengerGuidedShoppingUrl,
  buildMessengerShoppingPayload,
  buildMessengerShoppingQuickReplies,
  handleMessengerGuidedShopping,
  isMessengerShoppingStartIntent,
  parseMessengerShoppingPayload,
} from "../../server/services/messengerGuidedShoppingService.js";

const createRepository = () => {
  const sessions = new Map();
  const options = {
    gender: [
      { value: "men", title: "رجالي", aliases: ["men", "رجالي"] },
      { value: "women", title: "حريمي", aliases: ["women", "حريمي"] },
    ],
    product_type: [{ value: "sneakers", title: "سنيكرز", aliases: ["sneakers", "سنيكرز"] }],
    grade: [{ value: "mirror", title: "ميرور أوريجنال", aliases: ["mirror", "ميرور", "ميرور اوريجنال"] }],
    size: [
      { value: "44", title: "44", aliases: ["44"] },
      { value: "45", title: "45", aliases: ["45"] },
    ],
  };
  const key = ({ tenantId, conversationId }) => `${tenantId}:${conversationId}`;
  return {
    sessions,
    async getSession(identity) {
      return sessions.get(key(identity)) || null;
    },
    async saveSession(identity) {
      sessions.set(key(identity), { step: identity.step, selections: { ...identity.selections } });
    },
    async clearSession(identity) {
      sessions.delete(key(identity));
    },
    async listOptions({ step }) {
      return options[step] || [];
    },
    async countMatches({ selections }) {
      return selections.gender === "men" && selections.grade === "mirror" && selections.size === "45" ? 3 : 0;
    },
  };
};

const runMessage = ({ repository, sent, messageText = "", payload = "" }) =>
  handleMessengerGuidedShopping({
    tenantId: 1,
    conversationId: "facebook_messenger:customer-1",
    messageText,
    quickReplyPayload: payload,
    baseUrl: "https://m1store-egy.com",
    repository,
    sendReply: async (outbound) => {
      sent.push(outbound);
      return { message_id: `mid-${sent.length}` };
    },
  });

test("detects deliberate shopping and greeting triggers without matching unrelated support questions", () => {
  assert.equal(isMessengerShoppingStartIntent("السلام عليكم"), true);
  assert.equal(isMessengerShoppingStartIntent("عايز أشتري كوتشي"), true);
  assert.equal(isMessengerShoppingStartIntent("المنتجات"), true);
  assert.equal(isMessengerShoppingStartIntent("فين طلبي؟"), false);
});

test("encodes and decodes Messenger shopping payloads", () => {
  const payload = buildMessengerShoppingPayload("select", "grade", "mirror original");
  assert.deepEqual(parseMessengerShoppingPayload(payload), {
    action: "select",
    field: "grade",
    value: "mirror original",
  });
  assert.equal(parseMessengerShoppingPayload("SOCIAL_SIZE_SELECT::{}"), null);
});

test("keeps quick replies within Messenger limit and includes navigation", () => {
  const options = Array.from({ length: 20 }, (_, index) => ({ value: String(index + 30), title: String(index + 30) }));
  const replies = buildMessengerShoppingQuickReplies({ step: "size", options });
  assert.equal(replies.length, 13);
  assert.equal(replies.at(-2).title, "↩️ رجوع");
  assert.equal(replies.at(-1).title, "🔄 ابدأ من جديد");
});

test("builds the public filtered in-stock storefront link", () => {
  assert.equal(
    buildMessengerGuidedShoppingUrl(
      { gender: "men", product_type: "sneakers", grade: "mirror", size: "45" },
      { baseUrl: "https://m1store-egy.com/" }
    ),
    "https://m1store-egy.com/share/available?gender=men&type=sneakers&quality=mirror&size=45&inStock=1&v=6"
  );
});

test("runs the complete guided Messenger journey and sends the matching link", async () => {
  const repository = createRepository();
  const sent = [];

  let result = await runMessage({ repository, sent, messageText: "السلام عليكم" });
  assert.equal(result.reason, "messenger_guided_shopping_gender");
  assert.match(sent.at(-1).replyText, /اختار القسم/);

  result = await runMessage({
    repository,
    sent,
    payload: buildMessengerShoppingPayload("select", "gender", "men"),
  });
  assert.equal(result.reason, "messenger_guided_shopping_product_type");

  result = await runMessage({
    repository,
    sent,
    payload: buildMessengerShoppingPayload("select", "product_type", "sneakers"),
  });
  assert.equal(result.reason, "messenger_guided_shopping_grade");

  result = await runMessage({
    repository,
    sent,
    payload: buildMessengerShoppingPayload("select", "grade", "mirror"),
  });
  assert.equal(result.reason, "messenger_guided_shopping_size");

  result = await runMessage({
    repository,
    sent,
    payload: buildMessengerShoppingPayload("select", "size", "45"),
  });
  assert.equal(result.reason, "messenger_guided_shopping_result");
  assert.equal(result.matches, 3);
  assert.equal(result.selections.size, "45");
  assert.match(sent.at(-1).replyText, /لقيتلك 3 منتج متاح/);
  assert.match(sent.at(-1).replyText, /gender=men&type=sneakers&quality=mirror&size=45&inStock=1&v=6/);
  assert.deepEqual(repository.sessions.get("1:facebook_messenger:customer-1"), {
    step: "complete",
    selections: { gender: "men", product_type: "sneakers", grade: "mirror", size: "45" },
  });
});

test("rejects stale or forged options without advancing the saved step", async () => {
  const repository = createRepository();
  const sent = [];
  await runMessage({ repository, sent, messageText: "ابدأ التسوق" });
  const result = await runMessage({
    repository,
    sent,
    payload: buildMessengerShoppingPayload("select", "gender", "kids"),
  });
  assert.equal(result.reason, "messenger_guided_shopping_invalid_selection");
  assert.equal(repository.sessions.get("1:facebook_messenger:customer-1").step, "gender");
});

test("supports back and restart navigation", async () => {
  const repository = createRepository();
  const sent = [];
  await runMessage({ repository, sent, messageText: "ابدأ التسوق" });
  await runMessage({ repository, sent, payload: buildMessengerShoppingPayload("select", "gender", "men") });
  await runMessage({ repository, sent, payload: buildMessengerShoppingPayload("back") });
  assert.equal(repository.sessions.get("1:facebook_messenger:customer-1").step, "gender");
  await runMessage({ repository, sent, messageText: "ابدأ من جديد" });
  assert.deepEqual(repository.sessions.get("1:facebook_messenger:customer-1"), { step: "gender", selections: {} });
});
