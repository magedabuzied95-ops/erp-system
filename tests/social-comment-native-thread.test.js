import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  commentChrome,
  commentThreadCanvas,
  compactCommentAge,
  isPageAuthoredComment,
  resolveCommentParentId,
  threadCommentsForDisplay,
} from "../src/modules/aiSupport/lib/socialCommentThread.js";

// The shapes the UI really receives: a server row, wrapped by the thread normalizer
// (raw = row), wrapped again by the workspace normalizer (raw = thread comment).
const serverRow = (overrides = {}) => ({
  comment_id: "1141007521595948_1",
  post_id: "109139174713691_1141007521595948",
  platform: "facebook",
  commenter_id: "27617983947902214",
  parent_comment_id: "",
  raw_payload: { source: "meta_comment_poll", page_id: "109139174713691", value: {} },
  ...overrides,
});
const asThreadComment = (row) => ({ id: row.comment_id, comment_id: row.comment_id, platform: row.platform, raw: row });
const asWorkspaceComment = (row) => {
  const thread = asThreadComment(row);
  return { id: row.comment_id, platform: row.platform, raw: thread };
};

test("replies are filed under the comment they answer, two levels at most", () => {
  const top = asWorkspaceComment(serverRow({ comment_id: "P_1" }));
  const other = asWorkspaceComment(serverRow({ comment_id: "P_2" }));
  const reply = asWorkspaceComment(serverRow({ comment_id: "P_3", parent_comment_id: "P_1" }));
  const replyToReply = asWorkspaceComment(serverRow({ comment_id: "P_4", parent_comment_id: "P_3" }));
  const groups = threadCommentsForDisplay([top, other, reply, replyToReply]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].comment, top);
  assert.deepEqual(groups[0].replies, [reply, replyToReply]);
  assert.deepEqual(groups[1].replies, []);
});

test("a top-level Facebook comment whose parent is the post stays top-level", () => {
  const row = serverRow({ comment_id: "1141007521595948_9", raw_payload: { page_id: "109139174713691", value: { parent_id: "109139174713691_1141007521595948" } } });
  const groups = threadCommentsForDisplay([asWorkspaceComment(row)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].replies.length, 0);
});

test("a reply whose parent is outside the loaded window is still shown", () => {
  const orphan = asWorkspaceComment(serverRow({ comment_id: "P_7", parent_comment_id: "P_missing" }));
  const groups = threadCommentsForDisplay([orphan]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].comment, orphan);
});

test("the parent id is read from the webhook payload when the column is empty", () => {
  const row = serverRow({ comment_id: "P_5", raw_payload: { value: { parent_id: "P_1" } } });
  assert.equal(resolveCommentParentId(asWorkspaceComment(row)), "P_1");
  assert.equal(resolveCommentParentId(asThreadComment(row)), "P_1");
});

test("a parent written in the other id form still matches", () => {
  const top = asWorkspaceComment(serverRow({ comment_id: "1141007521595948_1" }));
  const reply = asWorkspaceComment(serverRow({ comment_id: "1141007521595948_2", parent_comment_id: "1" }));
  const groups = threadCommentsForDisplay([top, reply]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].replies, [reply]);
});

test("the page's own reply is recognised on every ingest path", () => {
  const webhook = serverRow({ commenter_id: "999", raw_payload: { is_page_authored: true } });
  const poll = serverRow({ commenter_id: "109139174713691" });
  const postPrefix = serverRow({ commenter_id: "109139174713691", raw_payload: {} });
  const customer = serverRow();
  assert.equal(isPageAuthoredComment(asWorkspaceComment(webhook)), true);
  assert.equal(isPageAuthoredComment(asWorkspaceComment(poll)), true);
  assert.equal(isPageAuthoredComment(asThreadComment(postPrefix)), true);
  assert.equal(isPageAuthoredComment(asWorkspaceComment(customer)), false);
  assert.equal(isPageAuthoredComment(asWorkspaceComment(serverRow({ commenter_id: "" }))), false);
});

test("the stamp is the compact one the platforms use", () => {
  const now = new Date("2026-09-11T12:00:00Z");
  assert.equal(compactCommentAge("2026-09-11T11:59:30Z", now, "en"), "now");
  assert.equal(compactCommentAge("2026-09-11T11:15:00Z", now, "en"), "45m");
  assert.equal(compactCommentAge("2026-09-11T09:00:00Z", now, "en"), "3h");
  assert.equal(compactCommentAge("2026-09-09T12:00:00Z", now, "en"), "2d");
  assert.equal(compactCommentAge("2026-08-21T12:00:00Z", now, "en"), "3w");
  assert.equal(compactCommentAge("2026-09-11T09:00:00Z", now, "ar"), "٣ س");
  assert.equal(compactCommentAge("", now, "ar"), "");
  assert.equal(compactCommentAge("not a date", now, "ar"), "");
});

test("Facebook draws a bubble, Instagram does not; a mixed thread sits on Facebook's surface", () => {
  assert.ok(commentChrome("facebook", "dark").bubble);
  assert.equal(commentChrome("instagram", "dark").bubble, "");
  assert.equal(commentChrome("facebook", "light").bubble, "#f0f2f5");
  const fb = asWorkspaceComment(serverRow());
  const ig = asWorkspaceComment(serverRow({ comment_id: "18000", platform: "instagram" }));
  assert.deepEqual(commentThreadCanvas([ig], "dark"), { platform: "instagram", mixed: false, canvas: "#000000" });
  assert.deepEqual(commentThreadCanvas([fb, ig], "dark"), { platform: "facebook", mixed: true, canvas: "#242526" });
});

test("the thread row draws a face and a name, never the old card chips", () => {
  const source = readFileSync(new URL("../src/modules/aiSupport/components/SocialCommentsWorkspace.jsx", import.meta.url), "utf8");
  const row = source.slice(source.indexOf("const SocialCommentsWorkspaceCommentRow"), source.indexOf("const SocialCommentThreadGroup"));
  assert.match(row, /<CustomerAvatar/);
  assert.match(row, /commentChrome\(/);
  assert.doesNotMatch(row, /<CommentTimelineCard/);
  // Lines are strokes and fills: this app pins every border colour to its token.
  const group = source.slice(source.indexOf("const ThreadElbow"), source.indexOf("const SentPageReply"));
  assert.doesNotMatch(group, /borderColor/);
});
