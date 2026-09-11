import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COMMENTER_LOOKUP_FAILED_BACKOFF_MS,
  COMMENTER_LOOKUP_REFUSED_BACKOFF_MS,
  commenterLookupOutcome,
  commenterProfileChannel,
  selectCommenterLookups,
} from "../server/services/metaCustomerProfileService.js";

const NOW = Date.parse("2026-09-11T12:00:00Z");
const seconds = (ms) => Math.floor(ms / 1000);
const live = `https://scontent.xx.fbcdn.net/v/a.jpg?oe=${seconds(NOW + 864e5).toString(16)}`;
const dead = `https://scontent.xx.fbcdn.net/v/a.jpg?oe=${seconds(NOW - 864e5).toString(16)}`;
const iso = (ms) => new Date(ms).toISOString();

const row = (overrides = {}) => ({
  platform: "facebook",
  commenter_id: "27617983947902214",
  commenter_name: "",
  commenter_profile_picture_url: "",
  profile_lookup: null,
  page_id: "109139174713691",
  page_authored: false,
  ...overrides,
});

test("a commenter with an id but no picture (every webhook) is looked up", () => {
  const picks = selectCommenterLookups({ rows: [row({ commenter_name: "Hend Mostafa" })], now: NOW });
  assert.equal(picks.length, 1);
  assert.deepEqual(
    { channel: picks[0].channel, missingName: picks[0].missingName, missingPicture: picks[0].missingPicture, pageId: picks[0].pageId },
    { channel: "facebook_messenger", missingName: false, missingPicture: true, pageId: "109139174713691" }
  );
});

test("a commenter with a name and a live picture is left alone", () => {
  assert.equal(selectCommenterLookups({ rows: [row({ commenter_name: "Omar", commenter_profile_picture_url: live })], now: NOW }).length, 0);
});

test("an expired signed picture is worth one more lookup, even right after an ok", () => {
  const picks = selectCommenterLookups({
    rows: [row({ commenter_name: "Omar", commenter_profile_picture_url: dead, profile_lookup: { status: "ok", at: iso(NOW - 60_000) } })],
    now: NOW,
  });
  assert.equal(picks.length, 1);
});

test("a generic or numeric stored name counts as missing", () => {
  assert.equal(selectCommenterLookups({ rows: [row({ commenter_name: "عميل", commenter_profile_picture_url: live })], now: NOW }).length, 1);
  assert.equal(selectCommenterLookups({ rows: [row({ commenter_name: "27617983947902214", commenter_profile_picture_url: live })], now: NOW }).length, 1);
});

test("refusals and failures are respected for their backoff, then retried", () => {
  const refusedRecently = row({ profile_lookup: { status: "refused", at: iso(NOW - 60_000) } });
  const refusedLongAgo = row({ profile_lookup: { status: "refused", at: iso(NOW - COMMENTER_LOOKUP_REFUSED_BACKOFF_MS - 1) } });
  const failedRecently = row({ profile_lookup: { status: "failed", at: iso(NOW - 60_000) } });
  const failedLongAgo = row({ profile_lookup: { status: "failed", at: iso(NOW - COMMENTER_LOOKUP_FAILED_BACKOFF_MS - 1) } });
  assert.equal(selectCommenterLookups({ rows: [refusedRecently], now: NOW }).length, 0);
  assert.equal(selectCommenterLookups({ rows: [refusedLongAgo], now: NOW }).length, 1);
  assert.equal(selectCommenterLookups({ rows: [failedRecently], now: NOW }).length, 0);
  assert.equal(selectCommenterLookups({ rows: [failedLongAgo], now: NOW }).length, 1);
});

test("the page itself, non-ids and duplicates are never asked about; the cap holds", () => {
  const rows = [
    row({ commenter_id: "109139174713691" }),
    row({ commenter_id: "999", page_authored: true }),
    row({ commenter_id: "abc" }),
    row({ commenter_id: "1234" }),
    row({ commenter_id: "11111111" }),
    row({ commenter_id: "11111111" }),
    row({ commenter_id: "22222222" }),
    row({ commenter_id: "33333333" }),
  ];
  const picks = selectCommenterLookups({ rows, selfIds: ["109139174713691"], now: NOW, limit: 2 });
  assert.deepEqual(picks.map((pick) => pick.commenterId), ["11111111", "22222222"]);
});

test("Instagram commenters are asked about on the Instagram profile endpoint", () => {
  assert.equal(commenterProfileChannel("instagram"), "instagram");
  assert.equal(commenterProfileChannel("facebook"), "facebook_messenger");
  const picks = selectCommenterLookups({ rows: [row({ platform: "instagram", commenter_id: "17841400000000001", commenter_name: "sara.styles" })], now: NOW });
  assert.equal(picks[0].channel, "instagram");
});

test("the outcome sorts what came back", () => {
  assert.deepEqual(commenterLookupOutcome({ name: "Hana", picture: live }), { status: "ok", kind: "" });
  assert.deepEqual(commenterLookupOutcome({ name: "Hana" }), { status: "incomplete", kind: "" });
  assert.deepEqual(commenterLookupOutcome({ failureKind: "unavailable" }), { status: "refused", kind: "unavailable" });
  assert.deepEqual(commenterLookupOutcome({ failureKind: "permission" }), { status: "refused", kind: "permission" });
  assert.deepEqual(commenterLookupOutcome({ failureKind: "timeout" }), { status: "failed", kind: "timeout" });
});

test("every path that learns of a commenter asks for their profile", () => {
  const meta = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  const center = readFileSync(new URL("../server/services/socialCommentsCenterService.js", import.meta.url), "utf8");
  // the webhook, right after the comment is stored
  assert.match(meta, /storeSocialCommentAutomationRuns\(\{ tenantId: config\.tenant_id, events: commentEvents \}\)[\s\S]{0,900}lookupSocialCommenterProfiles\(\{[^}]*source: "webhook"/);
  // the one-minute sweep, outside the Graph scan's try
  assert.match(meta, /await lookupSocialCommenterProfilesForAllTenants\(\);/);
  // opening a thread
  assert.match(center, /await nameThreadCommenters\(\{ tenantId: safeTenantId, platform: normalizedPlatform, rows: normalizedRows \}\)/);
  assert.match(center, /lookupSocialCommenterProfiles\(\{[\s\S]*?source: "thread_open"/);
});
