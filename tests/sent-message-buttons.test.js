import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  hasTranscriptButtons,
  installSentMessageButtonsObserver,
  mergeSentButtons,
  noteRowAwaitingSentButtons,
  partsFromCloudMessage,
  partsFromEvolutionRequest,
  partsFromMetaEchoAttachments,
  partsFromMetaMessage,
  recallSentMessageButtons,
  rememberSentMessageButtons,
  resetSentMessageButtonsForTests,
  setSentButtonsRowPatcher,
  setSentTemplateLookupForTests,
} from "../server/utils/sentMessageButtons.js";

const types = (actions) => actions.map((action) => action.type);

test("Messenger button template: its text and every button", () => {
  const parts = partsFromMetaMessage({
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "تحب تأكد الطلب؟",
        buttons: [
          { type: "postback", title: "✅ تأكيد", payload: "ORDER_CONFIRM" },
          { type: "web_url", title: "تتبع الطلب", url: "https://m1store-egy.com/track" },
          { type: "phone_number", title: "اتصل بينا", payload: "+201000000000" },
        ],
      },
    },
  });
  assert.equal(parts.message, "تحب تأكد الطلب؟");
  assert.deepEqual(types(parts.actions), ["whatsapp_reply_button", "whatsapp_url_button", "whatsapp_call_button"]);
  assert.equal(parts.actions[1].value, "https://m1store-egy.com/track");
});

test("Instagram / Messenger quick replies become reply buttons", () => {
  const parts = partsFromMetaMessage({
    text: "اختار المقاس",
    quick_replies: [
      { content_type: "text", title: "42", payload: "SIZE::42" },
      { content_type: "text", title: "43", payload: "SIZE::43" },
      { content_type: "user_phone_number" },
    ],
  });
  assert.equal(parts.message, "اختار المقاس");
  assert.deepEqual(parts.actions.map((action) => action.title), ["42", "43"]);
});

test("a lone generic card reads as header + body + buttons; a carousel is left to the card path", () => {
  const single = partsFromMetaMessage({
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{ title: "ملخص الطلب", subtitle: "الإجمالي 950 جنيه", buttons: [{ type: "postback", title: "✅ تأكيد الطلب", payload: "ORDER_CONFIRM" }] }],
      },
    },
  });
  assert.deepEqual(types(single.actions), ["whatsapp_header", "whatsapp_reply_button"]);
  assert.equal(single.message, "الإجمالي 950 جنيه");
  const carousel = partsFromMetaMessage({
    attachment: { type: "template", payload: { template_type: "generic", elements: [{ title: "a", buttons: [{ type: "postback", title: "x" }] }, { title: "b" }] } },
  });
  assert.equal(carousel.actions.length, 0);
});

test("the echo of our own button template carries the same buttons", () => {
  const parts = partsFromMetaEchoAttachments([
    { type: "template", payload: { template_type: "button", text: "أهلاً", buttons: [{ type: "postback", title: "ابدأ", payload: "START" }] } },
  ]);
  assert.equal(parts.message, "أهلاً");
  assert.equal(parts.actions[0].title, "ابدأ");
  assert.equal(partsFromMetaEchoAttachments([{ type: "image", payload: { url: "x" } }]).actions.length, 0);
});

test("Cloud interactive message: reply buttons, footer, header", async () => {
  const parts = await partsFromCloudMessage({
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: "M1 Store" },
      body: { text: "اختار" },
      footer: { text: "شكراً" },
      action: { buttons: [{ type: "reply", reply: { id: "a", title: "أ" } }, { type: "reply", reply: { id: "b", title: "ب" } }] },
    },
  });
  assert.deepEqual(types(parts.actions), ["whatsapp_header", "whatsapp_footer", "whatsapp_reply_button", "whatsapp_reply_button"]);
});

test("Cloud template: the buttons come from the stored definition, the values from the send", async () => {
  const lookups = [];
  const parts = await partsFromCloudMessage(
    {
      type: "template",
      template: {
        name: "order_shipped",
        language: { code: "ar" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "أحمد" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "track?order=55" }] },
          { type: "button", sub_type: "copy_code", index: "2", parameters: [{ type: "coupon_code", coupon_code: "M1SAVE" }] },
        ],
      },
    },
    {
      lookupTemplate: async (key) => {
        lookups.push(key);
        return {
          header_format: "TEXT",
          header_text: "طلبك اتشحن",
          body_text: "أهلاً {{1}}",
          footer_text: "M1 Store",
          buttons: [
            { type: "URL", text: "تتبع الشحنة", url: "https://m1store-egy.com/{{1}}" },
            { type: "QUICK_REPLY", text: "تمام" },
            { type: "COPY_CODE", text: "", example: "X" },
          ],
        };
      },
    }
  );
  assert.deepEqual(lookups, [{ name: "order_shipped", language: "ar" }]);
  assert.equal(parts.message, "أهلاً أحمد");
  const url = parts.actions.find((action) => action.type === "whatsapp_url_button");
  assert.equal(url.value, "https://m1store-egy.com/track?order=55");
  assert.equal(parts.actions.find((action) => action.type === "whatsapp_copy_button").value, "M1SAVE");
  assert.ok(parts.actions.some((action) => action.type === "whatsapp_reply_button" && action.title === "تمام"));
});

test("Evolution buttons, list and carousel requests", () => {
  const buttons = partsFromEvolutionRequest("/message/sendButtons/m1", {
    title: "تأكيد الطلب",
    description: "أكد طلبك",
    footer: "M1 Store",
    buttons: [{ type: "reply", displayText: "✅ تأكيد", id: "confirm" }, { type: "url", displayText: "الفاتورة", url: "https://m1store-egy.com/i/1" }],
  });
  assert.equal(buttons.message, "أكد طلبك");
  assert.deepEqual(types(buttons.actions), ["whatsapp_header", "whatsapp_footer", "whatsapp_reply_button", "whatsapp_url_button"]);
  const list = partsFromEvolutionRequest("/message/sendList/m1", {
    title: "اختار",
    description: "المقاسات",
    buttonText: "شوف المقاسات",
    footerText: "",
    sections: [{ title: "متاح", rows: [{ title: "42", rowId: "s42" }] }],
  });
  assert.deepEqual(types(list.actions), ["whatsapp_header", "whatsapp_list_button", "whatsapp_list_row"]);
  const carousel = partsFromEvolutionRequest("/message/sendCarousel/m1", { body: "الألوان", cards: [{ body: "أسود", buttons: [{ type: "reply", displayText: "اطلب ده", id: "c1" }] }] });
  assert.equal(carousel.actions[0].title, "اطلب ده");
});

test("merge: a row that already has buttons keeps them; a header already in the text is not repeated", () => {
  const sent = [
    { type: "whatsapp_header", title: "رأيك يهمنا ⭐" },
    { type: "whatsapp_footer", title: "M1 Store" },
    { type: "whatsapp_url_button", title: "قيّم", value: "https://x" },
  ];
  assert.deepEqual(mergeSentButtons([{ type: "whatsapp_reply_button", title: "قديم" }], sent, ""), [{ type: "whatsapp_reply_button", title: "قديم" }]);
  const merged = mergeSentButtons(["ask_size"], sent, "رأيك يهمنا ⭐\n\nالنص");
  assert.equal(merged[0], "ask_size");
  assert.deepEqual(types(merged.slice(1)), ["whatsapp_footer", "whatsapp_url_button"]);
  assert.equal(hasTranscriptButtons(["ask_size"]), false);
});

test("a row stored before the send's answer was read is patched when the buttons land", async () => {
  resetSentMessageButtonsForTests();
  const patched = [];
  setSentButtonsRowPatcher(async (value) => patched.push(value));
  noteRowAwaitingSentButtons("wamid.1", { id: 77, tenant_id: 1, session_id: "whatsapp:201", message_text: "نص" });
  rememberSentMessageButtons("wamid.1", { message: "نص", actions: [{ type: "whatsapp_reply_button", title: "تمام" }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(patched.length, 1);
  assert.equal(patched[0].rowId, 77);
  assert.equal(patched[0].actions[0].title, "تمام");
  assert.equal(recallSentMessageButtons("wamid.1").actions.length, 1);
  setSentButtonsRowPatcher(null);
});

test("the wire observer reads Graph and Evolution sends and leaves everything else alone", async () => {
  resetSentMessageButtonsForTests();
  setSentTemplateLookupForTests(async () => null);
  const realFetch = globalThis.fetch;
  const answers = {
    "https://graph.facebook.com/v21.0/me/messages?access_token=t": { recipient_id: "1", message_id: "m_meta" },
    "https://graph.facebook.com/v21.0/123/messages": { messages: [{ id: "wamid.cloud" }] },
    "http://evolution:8080/message/sendButtons/m1": { key: { id: "EVO1" } },
    "https://graph.facebook.com/v21.0/me/feed": { id: "post" },
  };
  globalThis.fetch = async (url) => new Response(JSON.stringify(answers[url] || {}), { status: 200, headers: { "content-type": "application/json" } });
  try {
    installSentMessageButtonsObserver();
    const meta = await fetch("https://graph.facebook.com/v21.0/me/messages?access_token=t", {
      method: "POST",
      body: JSON.stringify({ recipient: { id: "1" }, message: { text: "اختار", quick_replies: [{ content_type: "text", title: "أسود", payload: "c" }] } }),
    });
    // The caller still reads its own answer.
    assert.equal((await meta.json()).message_id, "m_meta");
    await fetch("https://graph.facebook.com/v21.0/123/messages", {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", to: "201", type: "interactive", interactive: { type: "button", body: { text: "b" }, action: { buttons: [{ reply: { id: "x", title: "X" } }] } } }),
    });
    await fetch("http://evolution:8080/message/sendButtons/m1", { method: "POST", body: JSON.stringify({ description: "d", buttons: [{ type: "reply", displayText: "Y", id: "y" }] }) });
    await fetch("https://graph.facebook.com/v21.0/me/feed", { method: "POST", body: JSON.stringify({ message: { text: "t", quick_replies: [{ title: "z" }] } }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(recallSentMessageButtons("m_meta").actions[0].title, "أسود");
    assert.equal(recallSentMessageButtons("wamid.cloud").actions[0].title, "X");
    assert.equal(recallSentMessageButtons("EVO1").actions[0].title, "Y");
    assert.equal(recallSentMessageButtons("post"), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("wiring: the boot installs the observer and every outbound row asks for the sent buttons", () => {
  const server = fs.readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
  assert.match(server, /installSentMessageButtonsObserver\(\);/);
  const log = fs.readFileSync(new URL("../server/services/aiSupportLogService.js", import.meta.url), "utf8");
  assert.match(log, /const args = withSentMessageButtons\(callerArgs\);/);
  assert.match(log, /awaitSentMessageButtons\(row, args\);/);
  // An echo that knows no buttons never wipes the stored ones.
  assert.match(log, /THEN suggested_actions\s+ELSE \$14::jsonb/);
  const route = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  assert.match(route, /messageType: "template",\s+suggestedActions: transcript\.actions,/);
});
