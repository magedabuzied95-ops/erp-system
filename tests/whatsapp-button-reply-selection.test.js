import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A WhatsApp button tap arrives as buttonsResponseMessage whose only plain text is the QUOTED
// original prompt — which contains ALL action labels (تأكيد/تعديل/إلغاء), so text-matching the
// quoted body is ambiguous and wrong. These guards pin the fix: the webhook must surface the
// SELECTED button (id + display text) and prefer it over any recursive text fallback.

const gatewaySource = fs.readFileSync(
  new URL("../server/services/whatsappGatewayService.js", import.meta.url),
  "utf8"
);
const confirmationSource = fs.readFileSync(
  new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url),
  "utf8"
);

test("extractMessageText consults the button-reply selection before any text fallback", () => {
  const fnStart = gatewaySource.indexOf("const extractMessageText = (data = {}, payload = {}) => {");
  assert.ok(fnStart > -1, "extractMessageText exists");
  const fnBody = gatewaySource.slice(fnStart, gatewaySource.indexOf("const directPaths", fnStart));
  assert.match(fnBody, /extractButtonReplySelection\(data, payload\)/);
  assert.match(fnBody, /selectedText \|\| buttonReply\.selectedId/);
});

test("the normalized inbound message carries selectedButtonId/selectedDisplayText", () => {
  assert.match(gatewaySource, /selectedButtonId: buttonReplySelection\.selectedId/);
  assert.match(gatewaySource, /selectedDisplayText: buttonReplySelection\.selectedText/);
});

test("the COD confirmation send goes buttons-first with a text fallback", () => {
  assert.match(confirmationSource, /sendOrderConfirmationInteractiveMessage\s*\(\s*\{/);
  assert.match(confirmationSource, /order-confirmation-buttons-unavailable/);
  // the reply parser that consumes selectedButtonId must keep reading it
  assert.match(confirmationSource, /message\.selectedButtonId/);
});

// Behavioral: run the REAL extractButtonReplySelection source against the exact payload shape
// Evolution 2.4.0 delivered for the live tap on 2026-08-24 (selectedButtonId confirm_order_livetest).
const helperStart = gatewaySource.indexOf("const extractButtonReplySelection = (data = {}, payload = {}) => {");
assert.ok(helperStart > -1);
const helperEnd = gatewaySource.indexOf("\n};", helperStart);
const helperSource = gatewaySource.slice(helperStart, helperEnd + 3);

const text = (value, fallback = "") => {
  const s = value === undefined || value === null ? "" : String(value).trim();
  return s || fallback;
};
const getPathValue = (root, path) =>
  path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), root);

// eslint-disable-next-line no-new-func
const extractButtonReplySelection = new Function(
  "text",
  "getPathValue",
  `${helperSource}\nreturn extractButtonReplySelection;`
)(text, getPathValue);

const liveTapPayload = {
  message: {
    buttonsResponseMessage: {
      type: 1,
      selectedButtonId: "confirm_order_livetest",
      selectedDisplayText: "✅ تأكيد الطلب",
      contextInfo: {
        quotedMessage: {
          interactiveMessage: {
            body: { text: "*تأكيد الطلب*\n\n✅ تأكيد الطلب\n✏️ تعديل الطلب\n❌ إلغاء الطلب" },
          },
        },
      },
    },
  },
};

test("a real buttonsResponseMessage tap resolves to the selected button, not the quoted prompt", () => {
  const selection = extractButtonReplySelection(liveTapPayload, {});
  assert.equal(selection.selectedId, "confirm_order_livetest");
  assert.equal(selection.selectedText, "✅ تأكيد الطلب");
});

test("a list row tap resolves through singleSelectReply", () => {
  const selection = extractButtonReplySelection(
    { message: { listResponseMessage: { title: "✅ تأكيد الطلب", singleSelectReply: { selectedRowId: "confirm_order:517" } } } },
    {}
  );
  assert.equal(selection.selectedId, "confirm_order:517");
  assert.equal(selection.selectedText, "✅ تأكيد الطلب");
});

test("a 2.4.0 native-flow reply resolves through paramsJson", () => {
  const selection = extractButtonReplySelection(
    {
      message: {
        interactiveResponseMessage: {
          body: { text: "✅ تأكيد الطلب" },
          nativeFlowResponseMessage: { paramsJson: '{"id":"confirm_order:517","display_text":"✅ تأكيد الطلب"}' },
        },
      },
    },
    {}
  );
  assert.equal(selection.selectedId, "confirm_order:517");
  assert.equal(selection.selectedText, "✅ تأكيد الطلب");
});

test("plain text messages are untouched (no selection)", () => {
  const selection = extractButtonReplySelection({ message: { conversation: "عايز اعرف المقاسات" } }, {});
  assert.equal(selection.selectedId, "");
  assert.equal(selection.selectedText, "");
});

test("the confirmation action regex resolves confirm_order:<id> from a button id", () => {
  // same pattern processConfirmationReply uses on whatsappButtonSignalValues candidates
  const match = "confirm_order:517".match(/(confirm_order|edit_order|cancel_order)(?::(\d+))?/i);
  assert.equal(match[1], "confirm_order");
  assert.equal(match[2], "517");
  assert.match(confirmationSource, /\(confirm_order\|edit_order\|cancel_order\)\(\?::\(\\d\+\)\)\?/);
});
