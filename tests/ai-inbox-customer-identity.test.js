import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  __resetDeadAvatarsForTests,
  avatarInitials,
  isKnownDeadAvatar,
  isMetaDmConversation,
  isUsableStoredName,
  metaCustomerAvatarUrl,
  metaCustomerDisplayName,
  metaCustomerUsername,
  rememberDeadAvatar,
  resolveMetaCustomerIdentity,
} from "../src/modules/aiSupport/lib/customerIdentity.js";

// ---------------------------------------------------------------------------
// Fallback order in the UI: real name → stored name → @username → id tail.
// ---------------------------------------------------------------------------
test("real profile name wins over everything", () => {
  const identity = resolveMetaCustomerIdentity({
    channel: "instagram",
    customer_name: "Old Stored",
    external_customer_id: "1044077131364783",
    customer_profile: { display_name: "Maged Abuzied", username: "maged" },
  });
  assert.deepEqual(identity, { name: "Maged Abuzied", source: "profile", kind: "instagram" });
});

test("stored name is used when Meta has not answered yet", () => {
  const identity = resolveMetaCustomerIdentity({
    channel: "facebook_messenger",
    customer_name: "Hend",
    external_customer_id: "5036593356360590",
  });
  assert.deepEqual(identity, { name: "Hend", source: "stored", kind: "messenger" });
});

test("username shows as @handle when there is no name at all", () => {
  const identity = resolveMetaCustomerIdentity({
    channel: "instagram",
    customer_name: "",
    external_customer_id: "1044077131364783",
    channel_metadata: { messenger_profile: { username: "@m1.store" } },
  });
  assert.deepEqual(identity, { name: "@m1.store", source: "username", kind: "instagram" });
  assert.equal(metaCustomerUsername({ customer_profile: { username: "@x" } }), "x");
});

test("last resort is the tail of the Meta user id — never the full id, never the same label for everyone", () => {
  const ig = resolveMetaCustomerIdentity({ channel: "instagram", customer_name: "1044077131364783", external_customer_id: "1044077131364783" });
  assert.equal(ig.source, "external_id");
  assert.equal(ig.name, "مستخدم Instagram …4783");
  const fb = resolveMetaCustomerIdentity({ channel: "facebook_messenger", session_id: "facebook_messenger:5036593356360590" }, { language: "en" });
  assert.equal(fb.name, "Messenger …0590");
  assert.notEqual(ig.name, fb.name);
  assert.equal(metaCustomerDisplayName({ channel: "instagram", customer_name: "", external_customer_id: "1044077131364783" }).includes("1044077131364783"), false);
});

test("a name that came from the Meta profile is shown even when it trips the chat-text rules", () => {
  for (const name of ["Ahmed 2020", "Mohamed A.", "هايدي", "فين مصطفى", "محمد احمد على حسن ابراهيم"]) {
    const identity = resolveMetaCustomerIdentity({
      channel: "facebook_messenger",
      external_customer_id: "5036593356360590",
      customer_profile: { display_name: name },
    });
    assert.deepEqual(identity, { name, source: "profile", kind: "messenger" }, `${name} must render as the customer name`);
  }
});

test("a stored name that is really a message, an id or a generic label is not usable", () => {
  assert.equal(isUsableStoredName("ممكن صور جوردن فور"), false);
  assert.equal(isUsableStoredName("5036593356360590"), false);
  assert.equal(isUsableStoredName("Customer"), false);
  assert.equal(isUsableStoredName("مستخدم Instagram"), false);
  assert.equal(isUsableStoredName("Hend Mostafa"), true);
  assert.equal(isUsableStoredName("هند مصطفى"), true);
});

test("comment threads are not Meta DM conversations; WhatsApp is not either", () => {
  assert.equal(isMetaDmConversation({ channel: "instagram" }), true);
  assert.equal(isMetaDmConversation({ channel: "facebook_messenger" }), true);
  assert.equal(isMetaDmConversation({ channel: "instagram_comment" }), false);
  assert.equal(isMetaDmConversation({ channel: "facebook", thread_kind: "comment" }), false);
  assert.equal(isMetaDmConversation({ channel: "whatsapp" }), false);
  assert.equal(resolveMetaCustomerIdentity({ channel: "whatsapp", external_customer_id: "201024960585" }).kind, "");
});

// ---------------------------------------------------------------------------
// Avatar: picture when available, placeholder otherwise, dead URLs remembered.
// ---------------------------------------------------------------------------
test("avatar url resolves from the conversation, the profile, or the Meta profile blob — http(s) only", () => {
  assert.equal(metaCustomerAvatarUrl({ customer_avatar_url: "https://cdn.example/a.jpg" }), "https://cdn.example/a.jpg");
  assert.equal(metaCustomerAvatarUrl({ customer_profile: { profile_pic_url: "https://cdn.example/b.jpg" } }), "https://cdn.example/b.jpg");
  assert.equal(metaCustomerAvatarUrl({ channel_metadata: { messenger_profile: { profile_pic: "https://cdn.example/c.jpg" } } }), "https://cdn.example/c.jpg");
  assert.equal(metaCustomerAvatarUrl({ customer_avatar_url: "not a url" }), "");
  assert.equal(metaCustomerAvatarUrl({}), "");
});

test("initials for the placeholder", () => {
  assert.equal(avatarInitials("Hend Mostafa"), "HM");
  assert.equal(avatarInitials("@m1.store"), "M");
  assert.equal(avatarInitials("هند مصطفى"), "هم");
  assert.equal(avatarInitials(""), "");
  assert.equal(avatarInitials("Instagram …4783"), "I4");
});

test("a dead avatar url is remembered for the session", () => {
  __resetDeadAvatarsForTests();
  assert.equal(isKnownDeadAvatar("https://cdn.example/dead.jpg"), false);
  rememberDeadAvatar("https://cdn.example/dead.jpg");
  assert.equal(isKnownDeadAvatar("https://cdn.example/dead.jpg"), true);
  __resetDeadAvatarsForTests();
});

// ---------------------------------------------------------------------------
// Wiring: both inbox surfaces and the customer drawer use the guarded avatar and
// the shared name order.
// ---------------------------------------------------------------------------
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("CustomerAvatar falls back on <img> error instead of leaving a broken image", () => {
  const component = read("../src/modules/aiSupport/components/CustomerAvatar.jsx");
  assert.match(component, /onError=\{\(\) => \{/);
  assert.match(component, /rememberDeadAvatar\(avatar\)/);
  assert.match(component, /data-customer-avatar-fallback="true"/);
  assert.match(component, /avatarInitials\(name\)/);
});

test("/admin/ai-inbox renders every customer avatar through CustomerAvatar and names Meta DMs through the shared order", () => {
  const page = read("../src/modules/aiSupport/pages/AiInbox.jsx");
  assert.doesNotMatch(page, /<img src=\{avatarUrl\}/, "no raw <img> avatar left in the ERP inbox");
  assert.ok((page.match(/<CustomerAvatar /g) || []).length >= 5);
  assert.match(page, /if \(isMessengerConversation\(source\) \|\| isMetaDmConversation\(source\)\) \{\s*return metaCustomerDisplayName\(source\) \|\| messengerDisplayName\(source\) \|\| "Customer";/);
  // the manual/auto profile sync now covers Instagram Direct as well
  assert.match(page, /isMetaDmConversation\(conversation\) \|\|\s*sessionId\.startsWith\("instagram:"\)/);
});

test("/inbox (PWA) names Meta DMs through the shared order and guards the header avatar", () => {
  const page = read("../src/modules/aiSupport/pages/AiInboxPwa.jsx");
  assert.match(page, /const identity = resolveMetaCustomerIdentity\(conversation\)/);
  assert.match(page, /<CustomerAvatar\s+url=\{selectedAvatar\}/);
  // auto-sync triggers for Instagram too, judged on the STORED name only
  assert.match(page, /if \(!conversation\?\.session_id \|\| !\(isMessengerConversation\(conversation\) \|\| isInstagramDmConversation\(conversation\)\)\) return false;/);
  assert.match(page, /const currentName = clean\(conversation\.customer_name \|\| conversation\.customer_profile\?\.name\);/);
});

test("a picture that stops loading asks the backend for a fresh one, on Meta channels as well as WhatsApp", () => {
  const page = read("../src/modules/aiSupport/pages/AiInbox.jsx");
  assert.match(page, /const requestFreshAvatar = \(conversation = \{\}\) => \{/);
  assert.match(page, /channel\.includes\("instagram"\)/);
  assert.match(page, /avatarRefreshRequested\.has\(target\)/, "one request per conversation per session");
  assert.equal((page.match(/onDead=\{\(\) => requestFreshAvatar\(/g) || []).length, 5, "every conversation avatar reports a dead picture");

  const pwa = read("../src/modules/aiSupport/pages/AiInboxPwa.jsx");
  assert.match(pwa, /const refreshable = channel === "whatsapp"/);
  assert.match(pwa, /\|\| channel\.includes\("instagram"\)/);
  assert.doesNotMatch(pwa, /if \(channel !== "whatsapp"\) return;/, "the WhatsApp-only gate is gone");

  const service = read("../server/services/metaIntegrationService.js");
  assert.match(service, /export const refreshMetaConversationAvatar = async/);
  assert.match(service, /metaProfileCoordinator\.clearFailure\(key\)/, "a known-dead picture forces past the backoff");
  assert.match(service, /forceRefresh: true/);

  const routes = read("../server/routes/aiAgentOrders.js");
  assert.match(routes, /refreshMetaConversationAvatar,/);
  assert.match(routes, /\? await refreshMetaConversationAvatar\(\{ tenantId, conversationId \}\)/);
  assert.match(routes, /reason: isMeta \? "meta_avatar_refreshed" : "whatsapp_avatar_refreshed"/);
});

test("Customer 360 drawer guards its avatar too", () => {
  const drawer = read("../src/modules/aiSupport/components/Customer360Drawer.jsx");
  assert.match(drawer, /<CustomerAvatar url=\{profileData\.avatar_url\}/);
});
