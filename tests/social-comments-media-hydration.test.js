import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(
  new URL("../server/services/socialCommentsCenterService.js", import.meta.url),
  "utf8"
);
const centerSource = fs.readFileSync(
  new URL("../src/modules/marketing/pages/SocialCommentsCenter.jsx", import.meta.url),
  "utf8"
);
const workspaceSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/SocialCommentsWorkspace.jsx", import.meta.url),
  "utf8"
);

test("social comments fast list returns post media stored in webhook payloads", () => {
  assert.match(serviceSource, /raw_payload->'post'->>'full_picture'/);
  assert.match(serviceSource, /raw_payload->'post'->>'picture'/);
  assert.match(serviceSource, /AS post_image_url/);
  assert.match(serviceSource, /thumbnail_url: text\(row\.post_image_url/);
});

test("social comments refreshes expired Meta media URLs without blocking the fast list", () => {
  assert.match(centerSource, /SocialCommentsCenter\.mediaHydration/);
  assert.match(centerSource, /hydrateFastSocialCommentMedia/);
  assert.match(centerSource, /setItems\(\(current\) => current\.map/);
});

test("comment image attachments continue to be rendered inside the thread", () => {
  assert.match(workspaceSource, /getCommentAttachmentImage/);
  assert.match(workspaceSource, /href=\{attachmentPreview\}/);
  assert.match(workspaceSource, /src=\{attachmentPreview\}/);
});
