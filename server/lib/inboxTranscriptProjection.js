// What GET /ai-inbox/conversations/:id/messages sends for each message. The
// stored row goes through normalizeInboxMessage, which fills ~60 fields with
// defaults; measured on production (2026-10-21) a 30-message page weighed
// 48-104KB, and most of it was weight no bubble draws:
//   - `productCards` is a byte-for-byte copy of `product_cards`;
//   - `suggested_products` repeats the cards whenever `product_cards` is set
//     (every reader takes `product_cards` first);
//   - each card carries the product's whole `variants` list, which the
//     transcript card never reads (it shows the chosen colour/size only);
//   - ~27% of the bytes were empty defaults ("" / null / []).
//
// Only fields that are fixed when the row is written are dropped when empty:
// the client merges a page over what it already holds with an object spread,
// so a field that can later be CLEARED (delivery_error, delivery_status,
// error_code, deleted_at, the message bodies) must always be sent, or the
// stale value would survive the merge. Deleting a message empties its
// attachments, cards, actions and edit history (normalizeInboxMessage), so
// those are always sent too.
const DROP_WHEN_EMPTY = Object.freeze([
  "external_reply_id",
  "quoted_message",
  "dedupe_key",
  "staff_user_id",
  "staff_user_name",
  "source_path",
  "insert_source",
  "whatsapp_instance",
  "edit_scope",
  "deleted_scope",
  "detected_intent",
  "post_id",
  "post_permalink_url",
  "post_message",
  "post_caption",
  "post_full_picture",
  "post_created_time",
  "comment_id",
  "commenter_id",
  "commenter_name",
  "commenter_profile_picture_url",
  "comment_created_time",
  "comment_url",
  "source_comment_text",
  "system_events",
]);

const isEmptyValue = (value) =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const slimTranscriptCard = (card) => {
  if (!card || typeof card !== "object" || !Array.isArray(card.variants)) return card;
  const { variants: _variants, ...rest } = card;
  return rest;
};

export const slimTranscriptMessage = (message) => {
  if (!message || typeof message !== "object") return message;
  const slim = { ...message };
  delete slim.productCards;
  if (Array.isArray(slim.product_cards)) {
    slim.product_cards = slim.product_cards.map(slimTranscriptCard);
    if (slim.product_cards.length) delete slim.suggested_products;
  }
  if (Array.isArray(slim.suggested_products)) slim.suggested_products = slim.suggested_products.map(slimTranscriptCard);
  for (const field of DROP_WHEN_EMPTY) {
    if (field in slim && isEmptyValue(slim[field])) delete slim[field];
  }
  return slim;
};

export const TRANSCRIPT_DROP_WHEN_EMPTY = DROP_WHEN_EMPTY;
