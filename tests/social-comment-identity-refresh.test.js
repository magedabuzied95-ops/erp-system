import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const automationSource = readFileSync(new URL("../server/services/socialCommentAutomationService.js", import.meta.url), "utf8");
const centerSource = readFileSync(new URL("../server/services/socialCommentsCenterService.js", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../src/modules/aiSupport/components/SocialCommentsWorkspace.jsx", import.meta.url), "utf8");
const timelineSource = readFileSync(new URL("../src/modules/aiSupport/components/socialCommentTimeline.jsx", import.meta.url), "utf8");

test("duplicate comment materialization refreshes stored customer identity", () => {
  assert.match(automationSource, /ON CONFLICT \(tenant_id, session_id, dedupe_key\)[\s\S]*DO UPDATE SET/);
  assert.match(automationSource, /commenter_id = COALESCE\(NULLIF\(EXCLUDED\.commenter_id/);
  assert.match(automationSource, /commenter_profile_picture_url = COALESCE/);
  assert.match(automationSource, /UPDATE social_comment_automation_runs[\s\S]*commenter_name = CASE/);
});

test("comment APIs recover identity from automation rows and raw Meta payloads", () => {
  assert.match(centerSource, /LEFT JOIN LATERAL \([\s\S]*source_commenter_name/);
  assert.match(centerSource, /raw_commenter_name/);
  assert.match(centerSource, /raw_commenter_picture/);
  assert.match(centerSource, /row\.source_commenter_profile_picture_url/);
});

test("desktop and PWA shared comment cards read nested Meta identity", () => {
  assert.match(workspaceSource, /rawValue\.from \|\| rawPayload\.from \|\| rawComment\.from/);
  assert.match(workspaceSource, /pictureUrlFrom\(rawFrom\?\.picture\)/);
  assert.match(timelineSource, /const nestedCommentIdentity/);
  assert.match(timelineSource, /commentIdentity\.name/);
  assert.match(timelineSource, /commentIdentity\.avatar/);
});
