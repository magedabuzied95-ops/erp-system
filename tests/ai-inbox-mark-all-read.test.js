import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import i18next from "i18next";

const desktop = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const service = readFileSync("server/services/aiSupportLogService.js", "utf8");
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));

const handler = desktop.slice(
  desktop.indexOf("const markAllConversationsRead = useCallback"),
  desktop.indexOf("useEffect", desktop.indexOf("const markAllConversationsRead = useCallback"))
);

test("mark-all-read asks before discarding the queue", () => {
  // Unread means "waiting for a reply". One unconfirmed click used to empty the
  // entire work queue with no way back.
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /aiSupport\.inbox\.ui\.markAllReadConfirm/);
  // And the confirm has to come BEFORE the optimistic wipe, or a cancel still
  // leaves the list looking cleared until the next refresh.
  assert.ok(
    handler.indexOf("window.confirm(") < handler.indexOf("setInbox("),
    "the confirmation must precede the optimistic update"
  );
});

test("mark-all-read is scoped to the channel on screen", () => {
  // Firing it with a channel tab selected used to clear every other channel too.
  assert.match(handler, /const scopeChannel = backendChannelFilter\(channelFilter\)/);
  assert.match(handler, /\.\.\.\(scopeChannel \? \{ channel: scopeChannel \} : \{\}\)/);
  // The optimistic update must clear the same set the request clears, not all.
  assert.match(handler, /targetKeys\.has\(conversationKey\(conversation\)\)/);
});

test("the server applies the channel scope to sessions as well as channel rows", () => {
  // The session UPDATE ignored the channel argument, so a scoped request still
  // marked every session on the tenant read.
  const fn = service.slice(
    service.indexOf("export const markAllAiSupportConversationsRead"),
    service.indexOf("export const updateAiSupportConversationState")
  );
  const sessionUpdate = fn.slice(fn.indexOf("UPDATE ai_support_sessions"), fn.indexOf("const channelResult"));
  assert.match(sessionUpdate, /\$3::text = ''/, "an empty channel must still mean every channel");
  assert.match(sessionUpdate, /c\.external_conversation_id = s\.session_id/, "sessions link to channel rows by session id");
  assert.match(sessionUpdate, /COALESCE\(\s*\(/);
  assert.match(sessionUpdate, /s\.channel,\s*s\.source/, "channel identity resolves the way the list resolves it");
});

test("both locales pluralise the confirmation for every Arabic count", async () => {
  // Arabic has six plural categories. `_one`/`_other` alone silently falls back
  // to English at 2, 3 and 11 — the counts an inbox actually shows.
  const instance = i18next.createInstance();
  await instance.init({
    lng: "ar",
    fallbackLng: "en",
    supportedLngs: ["ar", "en"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    resources: {
      ar: { translation: { aiSupport: ar } },
      en: { translation: { aiSupport: en } },
    },
  });

  for (const count of [0, 1, 2, 3, 11, 100]) {
    for (const key of ["markAllReadConfirm", "markAllReadDone"]) {
      const value = instance.t(`aiSupport.inbox.ui.${key}`, { count, scope: "واتساب" });
      assert.doesNotMatch(value, /[A-Za-z]{3}/, `ar ${key} fell back to English at count ${count}: ${value}`);
      assert.doesNotMatch(value, new RegExp(key), `ar ${key} rendered the raw key at count ${count}`);
    }
  }

  await instance.changeLanguage("en");
  for (const count of [1, 2]) {
    const value = instance.t("aiSupport.inbox.ui.markAllReadDone", { count });
    assert.match(value, /marked as read/, `en rendered "${value}" at count ${count}`);
  }
});
