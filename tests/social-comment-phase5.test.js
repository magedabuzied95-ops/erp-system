import test from "node:test";
import assert from "node:assert/strict";

import db from "../server/database/db.js";
import {
  buildSocialCommentAutomationDecision,
  executeSocialCommentAutomation,
} from "../server/services/socialCommentAutomationService.js";

test.after(async () => {
  await db.end().catch(() => {});
});

const baseRow = {
  tenant_id: 1,
  platform: "facebook",
  channel: "facebook_comment",
  comment_id: "comment-1",
  root_comment_id: "root-1",
  inbox_conversation_id: "social_comment:facebook:root-1",
  classification_label: "lead_price",
  classification_score: 0.97,
  commenter_name: "Test Buyer",
  original_comment_text: "السعر كام؟",
  post_permalink: "https://facebook.com/post/1",
  like_status: null,
  public_reply_status: null,
  dm_status: null,
  action_taken: "classified_only",
  automation_state: {},
};

const enabledSettings = {
  auto_like_enabled: true,
  auto_public_reply_enabled: true,
  auto_private_message_enabled: true,
  min_confidence: 0.9,
  public_reply_template: "تم إرسال التفاصيل في رسالة خاصة ",
  private_message_template: "تم إرسال التفاصيل في رسالة خاصة ",
};
const allFlags = { like: true, publicReply: true, privateMessage: true };

test("high-confidence lead_price triggers automation when flags ON", async () => {
  let likeCalls = 0;
  let publicReplyCalls = 0;
  let privateMessageCalls = 0;
  let publicReplyMessage = "";
  const transcriptRows = [];
  const persistedRows = [];

  const result = await executeSocialCommentAutomation({
    tenantId: 1,
    row: baseRow,
    conversation: { session_id: baseRow.inbox_conversation_id, metadata: { lead: { suggested_reply: "اقتراح" } } },
    featureFlags: allFlags,
    automationSettings: enabledSettings,
    deps: {
      likeCommentFn: async () => {
        likeCalls += 1;
        return { id: "like-1" };
      },
      replyToCommentFn: async (_platform, _commentId, message) => {
        publicReplyCalls += 1;
        publicReplyMessage = message;
        return { id: "reply-1" };
      },
      sendPrivateReplyFn: async () => {
        privateMessageCalls += 1;
        return { id: "dm-1" };
      },
      appendTranscriptFn: async (payload) => {
        transcriptRows.push(payload);
        return payload;
      },
      persistStateFn: async (payload) => {
        persistedRows.push(payload);
        return {
          ...baseRow,
          action_taken: payload.actionTaken,
          like_status: payload.likeStatus,
          public_reply_status: payload.publicReplyStatus,
          dm_status: payload.dmStatus,
          error_code: payload.errorCode,
          automation_state: payload.automationState,
          inbox_conversation_id: payload.sessionId,
        };
      },
    },
  });

  assert.equal(likeCalls, 1);
  assert.equal(publicReplyCalls, 1);
  assert.equal(privateMessageCalls, 1);
  assert.equal(publicReplyMessage, enabledSettings.public_reply_template.trim());
  assert.equal(result.status, "completed");
  assert.equal(result.like_status, "sent");
  assert.equal(result.public_reply_status, "sent");
  assert.equal(result.dm_status, "sent");
  assert.equal(persistedRows.at(-1)?.actionTaken, "automation_completed");
  assert.ok(transcriptRows.some((row) => row.messageType === "comment_like" && row.deliveryStatus === "sent"));
  assert.ok(transcriptRows.some((row) => row.messageType === "comment_public_reply" && row.deliveryStatus === "sent"));
  assert.ok(transcriptRows.some((row) => row.messageType === "comment_private_reply" && row.deliveryStatus === "sent"));
});

test("engagement_only does not trigger automation", async () => {
  const decision = buildSocialCommentAutomationDecision({
    row: {
      ...baseRow,
      classification_label: "engagement_only",
      classification_score: 0.93,
    },
    featureFlags: allFlags,
    automationSettings: enabledSettings,
  });

  assert.equal(decision.enabled, false);
  assert.equal(decision.reason, "ineligible_comment");

  let invoked = 0;
  const result = await executeSocialCommentAutomation({
    tenantId: 1,
    row: {
      ...baseRow,
      classification_label: "engagement_only",
      classification_score: 0.93,
    },
    conversation: { session_id: baseRow.inbox_conversation_id, metadata: { lead: { suggested_reply: "اقتراح" } } },
    featureFlags: allFlags,
    automationSettings: enabledSettings,
    deps: {
      likeCommentFn: async () => {
        invoked += 1;
        return { id: "like-1" };
      },
      replyToCommentFn: async () => {
        invoked += 1;
        return { id: "reply-1" };
      },
      sendPrivateReplyFn: async () => {
        invoked += 1;
        return { id: "dm-1" };
      },
      persistStateFn: async (payload) => ({
        ...baseRow,
        action_taken: payload.actionTaken,
        like_status: payload.likeStatus,
        public_reply_status: payload.publicReplyStatus,
        dm_status: payload.dmStatus,
        error_code: payload.errorCode,
        automation_state: payload.automationState,
      }),
    },
  });

  assert.equal(invoked, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "ineligible_comment");
});

test("duplicate webhook does not duplicate reply or DM", async () => {
  let likeCalls = 0;
  let publicReplyCalls = 0;
  let privateMessageCalls = 0;

  const deps = {
    likeCommentFn: async () => {
      likeCalls += 1;
      return { id: "like-1" };
    },
    replyToCommentFn: async () => {
      publicReplyCalls += 1;
      return { id: "reply-1" };
    },
    sendPrivateReplyFn: async () => {
      privateMessageCalls += 1;
      return { id: "dm-1" };
    },
    persistStateFn: async (payload) => ({
      ...baseRow,
      action_taken: payload.actionTaken,
      like_status: payload.likeStatus,
      public_reply_status: payload.publicReplyStatus,
      dm_status: payload.dmStatus,
      error_code: payload.errorCode,
      automation_state: payload.automationState,
    }),
  };

  await executeSocialCommentAutomation({
    tenantId: 1,
    row: baseRow,
    conversation: { session_id: baseRow.inbox_conversation_id, metadata: { lead: { suggested_reply: "اقتراح" } } },
    featureFlags: allFlags,
    automationSettings: enabledSettings,
    deps,
  });

  await executeSocialCommentAutomation({
    tenantId: 1,
    row: {
      ...baseRow,
      like_status: "sent",
      public_reply_status: "sent",
      dm_status: "sent",
      action_taken: "automation_completed",
      automation_state: { overall_status: "completed" },
    },
    conversation: { session_id: baseRow.inbox_conversation_id, metadata: { lead: { suggested_reply: "اقتراح" } } },
    featureFlags: allFlags,
    automationSettings: enabledSettings,
    deps,
  });

  assert.equal(likeCalls, 1);
  assert.equal(publicReplyCalls, 1);
  assert.equal(privateMessageCalls, 1);
});

test("Meta send failure persists failed transcript rows", async () => {
  const transcriptRows = [];
  const persistedRows = [];

  const result = await executeSocialCommentAutomation({
    tenantId: 1,
    row: baseRow,
    conversation: { session_id: baseRow.inbox_conversation_id, metadata: { lead: { suggested_reply: "اقتراح" } } },
    featureFlags: { like: false, publicReply: true, privateMessage: false },
    automationSettings: enabledSettings,
    deps: {
      replyToCommentFn: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "", status: null });
      },
      appendTranscriptFn: async (payload) => {
        transcriptRows.push(payload);
        return payload;
      },
      persistStateFn: async (payload) => {
        persistedRows.push(payload);
        return {
          ...baseRow,
          action_taken: payload.actionTaken,
          like_status: payload.likeStatus,
          public_reply_status: payload.publicReplyStatus,
          dm_status: payload.dmStatus,
          error_code: payload.errorCode,
          automation_state: payload.automationState,
        };
      },
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.public_reply_status, "failed");
  assert.equal(persistedRows.at(-1)?.publicReplyStatus, "failed");
  assert.equal(persistedRows.at(-1)?.errorCode, "transport_failed");
  assert.ok(transcriptRows.some((row) => row.messageType === "comment_public_reply" && row.deliveryStatus === "failed"));
  assert.ok(transcriptRows.some((row) => row.messageType === "automation_error" && row.deliveryStatus === "failed"));
});

test("default settings stay off and low confidence blocks automation", () => {
  const defaultDecision = buildSocialCommentAutomationDecision({
    row: { ...baseRow, classification_score: 0.97 },
    featureFlags: allFlags,
    automationSettings: {
      auto_like_enabled: false,
      auto_public_reply_enabled: false,
      auto_private_message_enabled: false,
      min_confidence: 0.9,
      public_reply_template: "تم إرسال التفاصيل في رسالة خاصة ",
      private_message_template: "",
    },
  });

  assert.equal(defaultDecision.enabled, false);
  assert.equal(defaultDecision.reason, "tenant_automation_disabled");

  const lowConfidenceDecision = buildSocialCommentAutomationDecision({
    row: { ...baseRow, classification_score: 0.75 },
    featureFlags: allFlags,
    automationSettings: enabledSettings,
  });

  assert.equal(lowConfidenceDecision.enabled, false);
  assert.equal(lowConfidenceDecision.reason, "low_confidence_comment");
});
