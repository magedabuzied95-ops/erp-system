import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLeadOpportunityPayload,
  resolveLeadSourceKey,
  resolveLeadSourceLabel,
} from "../server/services/aiInboxLeadActionsService.js";

test("lead source helpers map inbox channels correctly", () => {
  assert.equal(resolveLeadSourceKey({ channel: "facebook_comment" }), "facebook_comment");
  assert.equal(resolveLeadSourceKey({ channel: "instagram_comment" }), "instagram_comment");
  assert.equal(resolveLeadSourceKey({ channel: "facebook_messenger" }), "messenger");
  assert.equal(resolveLeadSourceLabel({ channel: "facebook_comment" }), "Facebook Comment");
  assert.equal(resolveLeadSourceLabel({ channel: "instagram_comment" }), "Instagram Comment");
  assert.equal(resolveLeadSourceLabel({ channel: "facebook_messenger" }), "Messenger");
});

test("lead opportunity payload includes source metadata", () => {
  const payload = buildLeadOpportunityPayload({
    conversation: {
      session_id: "conv-1",
      channel: "instagram_comment",
      external_comment_id: "comment-7",
      external_customer_id: "ig-user-44",
      latest_message_preview: "عايز السعر",
      customer_name: "Sara",
    },
    profile: {
      id: 11,
      first_name: "Sara",
      last_name: "Ali",
      conversation_summary: "Interested in pricing",
    },
  });

  assert.equal(payload.source_key, "instagram_comment");
  assert.equal(payload.source_label, "Instagram Comment");
  assert.equal(payload.title, "Instagram Comment Lead");
  assert.equal(payload.notes, "Interested in pricing");
  assert.equal(payload.metadata.conversation_id, "conv-1");
  assert.equal(payload.metadata.comment_id, "comment-7");
  assert.equal(payload.metadata.external_customer_id, "ig-user-44");
});
