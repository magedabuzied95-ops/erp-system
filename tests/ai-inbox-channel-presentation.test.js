import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");

test("AI Inbox renders each direct-message channel with its own label", () => {
  assert.match(source, /channel === "whatsapp"\) return "WhatsApp"/);
  assert.match(source, /channel === "instagram"\) return "Instagram DM"/);
  assert.match(source, /channel === "messenger"\) return "Messenger"/);
  assert.match(source, /channel === "web"\) return "Web Chat"/);
});

test("AI Inbox renders WhatsApp and Instagram with their own icons", () => {
  assert.match(source, /channel === "whatsapp"\) return FaWhatsapp/);
  assert.match(source, /channel === "instagram"\) return FaInstagram/);
  assert.match(source, /channel === "messenger"\) return FaFacebookMessenger/);
});
