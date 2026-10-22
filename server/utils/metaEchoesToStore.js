/*
 * Template sends whose ONLY inbox record is going to be Meta's echo.
 *
 * The inbox's own product send writes its carousel row itself, and the echo handler throws the
 * echo away as a duplicate (classifyMetaCarouselEcho). The comment → DM automation writes no row:
 * the echo is all the thread ever gets. Both look the same to the echo handler — a template from
 * us to this customer — so a comment DM landing within minutes of an inbox send was thrown away
 * too, and the thread never showed it (2026-10-22, Ana Zeinab).
 *
 * A sender that relies on the echo leaves the message id Meta returned here; an echo under one of
 * these ids is always stored.
 */
const TTL_MS = 10 * 60 * 1000;
const ids = new Map();

export const noteMetaEchoToStore = (messageId = "") => {
  const id = String(messageId ?? "").trim();
  if (!id) return;
  const now = Date.now();
  for (const [key, at] of ids) {
    if (now - at > TTL_MS) ids.delete(key);
    else break;
  }
  ids.set(id, now);
};

export const isMetaEchoToStore = (messageId = "") => {
  const at = ids.get(String(messageId ?? "").trim());
  return Boolean(at && Date.now() - at <= TTL_MS);
};
