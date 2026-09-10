import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The hide/unhide button. Three code paths hide a comment on their own — the word filter, the
   per-post switch, and the DM worker — and the button is how the owner takes it back. It only
   works if every one of those paths RECORDS what it did, and if the button reads that record. */

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const automation = read("../server/services/socialCommentAutomationService.js");
const worker = read("../server/services/backgroundJobs.js");
const routes = read("../server/routes/socialComments.js");
const row = read("../src/modules/aiSupport/components/SocialCommentsWorkspace.jsx");
const pwa = read("../src/modules/aiSupport/pages/AiInboxPwa.jsx");

const recordsAfterHide = (source, label) => {
  const hides = [...source.matchAll(/await hideComment\(/g)].map((match) => match.index);
  assert.ok(hides.length > 0, `${label}: no hide call found`);
  for (const index of hides) {
    const window = source.slice(index, index + 400);
    assert.match(
      window,
      /recordSocialCommentVisibility\(\{[\s\S]*?hidden: true/,
      `${label}: a hide at offset ${index} is never recorded, so its comment gets no "unhide" button`
    );
  }
};

test("every automatic hide records itself, so the button can find it", () => {
  recordsAfterHide(automation, "automation service");
  recordsAfterHide(worker, "DM worker");
});

test("the manual route records only AFTER Meta accepted the call", () => {
  const start = routes.indexOf('router.post("/comments/:commentId/visibility"');
  assert.ok(start > 0, "the visibility route is gone");
  const body = routes.slice(start, routes.indexOf("\n});", start));
  const call = body.indexOf("await setCommentHidden(");
  const record = body.indexOf("await recordSocialCommentVisibility(");
  assert.ok(call > 0 && record > 0, "the route must both call Meta and record");
  assert.ok(record > call, "recording before the Graph call would claim a state Meta never reached");
});

test("the lookup route answers in one query for every comment on screen", () => {
  const start = routes.indexOf('router.get("/visibility"');
  assert.ok(start > 0, "the batched visibility lookup is gone");
  const body = routes.slice(start, routes.indexOf("\n});", start));
  assert.match(body, /comment_id = ANY\(\$3::text\[\]\)/, "it must be one ANY() query, not one per comment");
  assert.match(body, /\.slice\(0, 200\)/, "and bounded");
});

test("the button sends the PROVIDER comment id, never a local row id", () => {
  const hook = row.indexOf("useCommentVisibility(");
  assert.ok(hook > 0, "the row no longer uses the visibility hook");
  const call = row.slice(hook, hook + 260);
  assert.match(call, /resolveSocialCommentActionId\(comment\)/, "the id must be the one Like and Reply send to Meta");
});

test("the hook cannot crash the page by reading a const declared later in the render", () => {
  const hook = row.indexOf("useCommentVisibility(");
  const call = row.slice(hook, hook + 260);
  assert.doesNotMatch(call, /cardComment/, "cardComment is declared below the hook — reading it is a TDZ crash");
});

test("the button only draws once the real state is known", () => {
  assert.match(
    row,
    /visibility\.enabled && visibility\.loaded \?/,
    "drawing before load would offer 'hide' on a comment the automation already hid"
  );
});

test("the hidden-state columns exist before anything reads or writes them", () => {
  // They come from a LAZY schema ensure that otherwise runs only when a comment arrives. Right
  // after a deploy the owner can press the button first; without these calls the write fails
  // silently and the button shows a state the database never recorded.
  const recordStart = automation.indexOf("export const recordSocialCommentVisibility");
  const recordBody = automation.slice(recordStart, automation.indexOf("\n};", recordStart));
  assert.ok(
    recordBody.indexOf("ensureSocialCommentAutomationSchema()") > 0 &&
      recordBody.indexOf("ensureSocialCommentAutomationSchema()") < recordBody.indexOf("UPDATE social_comment_automation_runs"),
    "the writer must ensure the columns before updating them"
  );
  const lookupStart = routes.indexOf('router.get("/visibility"');
  const lookupBody = routes.slice(lookupStart, routes.indexOf("\n});", lookupStart));
  assert.ok(
    lookupBody.indexOf("ensureSocialCommentAutomationSchema()") > 0 &&
      lookupBody.indexOf("ensureSocialCommentAutomationSchema()") < lookupBody.indexOf("SELECT comment_id, hidden_at"),
    "the lookup must ensure the columns before selecting them"
  );
});

test("the PWA gets the button because it renders the same row", () => {
  // One component, two surfaces. If the PWA ever forks its own row, the button has to be ported.
  assert.match(pwa, /SocialCommentsWorkspaceCommentRow/, "the PWA no longer renders the shared comment row");
});
