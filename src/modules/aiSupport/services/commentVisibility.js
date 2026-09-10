import { useCallback, useEffect, useState } from "react";

import { api } from "../../../shared/api/api";

/* Whether a Meta comment is hidden, for the hide/unhide button on a comment row.

   The row is shared by the desktop workspace and the AI Inbox PWA, and neither gets hidden state in
   its comment feed — it lives on the automation runs table. So every row asks for its own, and the
   asks are BATCHED: all rows that mount in the same tick go out as one GET per platform. A thread
   of forty comments is one request, not forty.

   Entries expire after a short while because the automation can hide a comment AFTER its row has
   drawn — the hide rides the DM worker and lands seconds later. */

const TTL_MS = 15000;
const FLUSH_DELAY_MS = 30;

const cache = new Map();
const pending = new Map();
let flushTimer = null;

const cacheKey = (platform, id) => `${platform}:${id}`;

const flush = async () => {
  flushTimer = null;
  const batches = [...pending.entries()];
  pending.clear();
  await Promise.all(
    batches.map(async ([platform, batch]) => {
      const ids = [...batch.ids];
      let visibility = {};
      try {
        const payload = await api.get("/social-comments/visibility", {
          params: { platform, ids: ids.join(",") },
        });
        visibility = payload?.visibility || {};
      } catch {
        // A failed lookup draws every comment as visible. The button still works; the next
        // refresh corrects the label.
        visibility = {};
      }
      const now = Date.now();
      for (const id of ids) {
        const entry = {
          hidden: Boolean(visibility[id]?.hidden),
          reason: String(visibility[id]?.reason || ""),
          at: now,
        };
        cache.set(cacheKey(platform, id), entry);
        for (const resolve of batch.waiters.get(id) || []) resolve(entry);
      }
    })
  );
};

export const loadCommentVisibility = (platform, id) => {
  const key = cacheKey(platform, id);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached);
  return new Promise((resolve) => {
    if (!pending.has(platform)) pending.set(platform, { ids: new Set(), waiters: new Map() });
    const batch = pending.get(platform);
    batch.ids.add(id);
    if (!batch.waiters.has(id)) batch.waiters.set(id, []);
    batch.waiters.get(id).push(resolve);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  });
};

export const setCommentVisibility = async (platform, id, hidden) => {
  const payload = await api.post(`/social-comments/comments/${encodeURIComponent(id)}/visibility`, {
    platform,
    hidden,
  });
  const entry = {
    hidden: Boolean(payload?.hidden ?? hidden),
    reason: hidden ? "manual" : "",
    at: Date.now(),
  };
  cache.set(cacheKey(platform, id), entry);
  return entry;
};

export const COMMENT_HIDDEN_REASON_LABELS = {
  banned_word: "كلمة محظورة",
  hide_customer_comments: "إخفاء تلقائي",
  manual: "يدوي",
};

export const useCommentVisibility = (platform = "", id = "") => {
  const safePlatform = String(platform || "").toLowerCase();
  // Only a real provider comment id on a Meta platform. A local row id sent to the Graph API would
  // hide nothing, or the wrong thing.
  const enabled = Boolean(id) && (safePlatform === "facebook" || safePlatform === "instagram");
  const [state, setState] = useState({ hidden: false, reason: "", loaded: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    loadCommentVisibility(safePlatform, id).then((entry) => {
      if (alive) setState({ hidden: entry.hidden, reason: entry.reason, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [enabled, safePlatform, id]);

  const toggle = useCallback(async () => {
    if (!enabled || saving) return null;
    setSaving(true);
    try {
      const entry = await setCommentVisibility(safePlatform, id, !state.hidden);
      setState({ hidden: entry.hidden, reason: entry.reason, loaded: true });
      return entry;
    } finally {
      setSaving(false);
    }
  }, [enabled, saving, safePlatform, id, state.hidden]);

  return { enabled, hidden: state.hidden, reason: state.reason, loaded: state.loaded, saving, toggle };
};
