import test from "node:test";
import assert from "node:assert/strict";

import {
  competitorInstagramUsernames,
  competitorPageUrl,
  normalizeApifyPost,
  normalizeInstagramPost,
  runApifyInstagramScraper,
  runApifyPostsScraper,
} from "../../server/modules/metaAds/integrations/competitorPosts.js";
import { isScheduleDue, renderReportText, splitForTelegram, summarizeCompetitor } from "../../server/modules/metaAds/integrations/competitorReports.js";

test("the page to scrape comes from the saved link, else the page id or username", () => {
  assert.equal(competitorPageUrl({ facebook_url: "facebook.com/RivalShoes" }), "https://facebook.com/RivalShoes");
  assert.equal(competitorPageUrl({ facebook_url: "https://m.facebook.com/RivalShoes", page_id: "1" }), "https://m.facebook.com/RivalShoes");
  assert.equal(competitorPageUrl({ page_id: "123456789" }), "https://www.facebook.com/profile.php?id=123456789");
  assert.equal(competitorPageUrl({ page_id: "rival.shoes" }), "https://www.facebook.com/rival.shoes");
  // A non-Facebook link is never sent to the scraper.
  assert.equal(competitorPageUrl({ facebook_url: "https://evil.example.com/page", page_id: "123" }), "");
  assert.equal(competitorPageUrl({}), "");
});

test("an Apify item becomes one post row with its engagement", () => {
  const post = normalizeApifyPost({
    postId: "987",
    url: "https://www.facebook.com/RivalShoes/posts/987",
    pageName: "Rival Shoes",
    text: "خصم 30% على الكوتشيات",
    time: "2026-10-20T12:00:00.000Z",
    likes: 120,
    comments: 15,
    shares: 5,
    viewsCount: 4000,
    media: [{ __typename: "Video", thumbnail: "https://scontent.example/v.jpg" }],
  });
  assert.equal(post.post_id, "987");
  assert.equal(post.media_type, "video");
  assert.equal(post.thumbnail_url, "https://scontent.example/v.jpg");
  assert.equal(post.engagement, 140);
  assert.equal(post.views, 4000);
  assert.equal(post.posted_at.toISOString(), "2026-10-20T12:00:00.000Z");
  assert.equal(normalizeApifyPost({ postId: "1", timestamp: 1760000000 }).posted_at.getTime(), 1760000000 * 1000);
  assert.equal(normalizeApifyPost({ error: "page not found", url: "x" }), null);
  assert.equal(normalizeApifyPost({ text: "no id" }), null);
});

test("the scraper is called with the page, a limit and a since-date, and a missing token is a clear 409", async () => {
  await assert.rejects(runApifyPostsScraper("https://facebook.com/x", { token: "" }), (error) => error.code === "APIFY_NOT_CONFIGURED");
  let call;
  const items = await runApifyPostsScraper("https://facebook.com/x", {
    token: "tok",
    now: new Date("2026-10-24T10:00:00Z"),
    fetchImpl: async (url, init) => {
      call = { url, init };
      return { ok: true, status: 200, json: async () => [{ postId: "1" }] };
    },
  });
  assert.deepEqual(items, [{ postId: "1" }]);
  assert.match(call.url, /\/acts\/apify~facebook-posts-scraper\/run-sync-get-dataset-items/);
  assert.equal(call.init.headers.Authorization, "Bearer tok");
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.startUrls, [{ url: "https://facebook.com/x" }]);
  assert.equal(body.onlyPostsNewerThan, "2026-10-10");
  await assert.rejects(
    runApifyPostsScraper("https://facebook.com/x", { token: "bad", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "nope" } }) }) }),
    (error) => error.code === "APIFY_BAD_TOKEN",
  );
});

test("a schedule is due once a week, on its weekday after 9 AM Cairo", () => {
  // 2026-10-24 is a Saturday (weekday 6); 09:30 Cairo = 06:30 UTC.
  const saturdayMorning = new Date("2026-10-24T06:30:00Z");
  assert.equal(isScheduleDue({ active: true, weekday: 6 }, saturdayMorning), true);
  assert.equal(isScheduleDue({ active: false, weekday: 6 }, saturdayMorning), false);
  assert.equal(isScheduleDue({ active: true, weekday: 0 }, saturdayMorning), false);
  assert.equal(isScheduleDue({ active: true, weekday: 6 }, new Date("2026-10-24T04:00:00Z")), false);
  assert.equal(isScheduleDue({ active: true, weekday: 6, last_report_at: "2026-10-24T06:00:00Z" }, saturdayMorning), false);
  assert.equal(isScheduleDue({ active: true, weekday: 6, last_report_at: "2026-10-17T06:00:00Z" }, saturdayMorning), true);
});

test("the summary ranks formats and top posts by engagement", () => {
  const summary = summarizeCompetitor({ id: 3, name: "Rival" }, [
    { url: "a", media_type: "photo", engagement: 10, likes: 10 },
    { url: "b", media_type: "video", engagement: 300, likes: 250, comments: 40, shares: 10 },
    { url: "c", media_type: "video", engagement: 100 },
  ], 7);
  assert.equal(summary.posts, 3);
  assert.equal(summary.posts_per_week, 3);
  assert.equal(summary.avg_engagement, 137);
  assert.equal(summary.formats[0].type, "video");
  assert.equal(summary.top_posts[0].url, "b");
});

test("the report text works with and without the AI, and long text splits for Telegram", () => {
  const summaries = [summarizeCompetitor({ id: 1, name: "Rival" }, [{ url: "https://fb.com/p/1", media_type: "video", engagement: 50, likes: 40, comments: 8, shares: 2 }])];
  const plain = renderReportText({ title: "تقرير", summaries, analysis: null });
  assert.match(plain, /Rival: 1 منشور/);
  assert.match(plain, /https:\/\/fb\.com\/p\/1/);
  assert.match(plain, /الأرقام فقط/);
  const full = renderReportText({
    title: "تقرير",
    summaries,
    analysis: {
      overview: "أسبوع قوي للفيديو.",
      competitors: [{ name: "Rival", strengths: ["ريلز يومي"], weaknesses: ["ردود بطيئة"], what_works: "الخصومات" }],
      viral_content: [{ competitor: "Rival", post_url: "https://fb.com/p/1", why: "عرض واضح" }],
      audience_insights: ["الفيديو القصير"],
      recommendations: ["انزل ريلز 3 مرات"],
      plan_30_days: [{ day: 2, format: "ريلز", idea: "قبل وبعد", hook: "شوف الفرق" }, { day: 1, format: "صورة", idea: "منتج جديد", hook: "" }],
    },
  });
  assert.match(full, /نقاط القوة والضعف/);
  assert.ok(full.indexOf("يوم 1 —") < full.indexOf("يوم 2 —"));
  assert.doesNotMatch(full, /الأرقام فقط/);
  const chunks = splitForTelegram(Array.from({ length: 300 }, (_, i) => `سطر رقم ${i} ${"x".repeat(30)}`).join("\n"), 1000);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
});

test("the Instagram accounts come from links or @handles, several allowed, non-Instagram links dropped", () => {
  assert.deepEqual(
    competitorInstagramUsernames({ instagram: "https://www.instagram.com/MiniManShoes/ @miniman_shoes, instagram.com/minimanshoes" }),
    ["minimanshoes", "miniman_shoes"],
  );
  assert.deepEqual(competitorInstagramUsernames({ instagram: "https://www.instagram.com/p/De0g4A6iJyU/" }), []);
  assert.deepEqual(competitorInstagramUsernames({ instagram: "https://evil.example.com/rival" }), []);
  assert.deepEqual(competitorInstagramUsernames({}), []);
});

test("an Instagram item becomes one post row, kept apart from Facebook ids", () => {
  const post = normalizeInstagramPost({
    id: "4014359684339681772",
    shortCode: "De13t0pt0ns",
    type: "Video",
    caption: "كولكشن جديد",
    url: "https://www.instagram.com/p/De13t0pt0ns/",
    displayUrl: "https://scontent.example/c.jpg",
    likesCount: 50,
    commentsCount: 2,
    videoPlayCount: 900,
    timestamp: "2026-10-23T10:00:00.000Z",
    ownerUsername: "minimanshoes",
  });
  assert.equal(post.post_id, "ig:4014359684339681772");
  assert.equal(post.media_type, "video");
  assert.equal(post.page_name, "@minimanshoes");
  assert.equal(post.engagement, 52);
  assert.equal(post.views, 900);
  assert.equal(post.posted_at.toISOString(), "2026-10-23T10:00:00.000Z");
  assert.equal(normalizeInstagramPost({ type: "Sidecar", id: "1" }).media_type, "album");
  assert.equal(normalizeInstagramPost({ error: "not_found" }), null);
});

test("the Instagram scraper is called with the usernames, a limit and a since-date", async () => {
  let call;
  await runApifyInstagramScraper(["minimanshoes"], {
    token: "tok",
    now: new Date("2026-10-24T10:00:00Z"),
    fetchImpl: async (url, init) => {
      call = { url, init };
      return { ok: true, status: 200, json: async () => [] };
    },
  });
  assert.match(call.url, /\/acts\/apify~instagram-post-scraper\/run-sync-get-dataset-items/);
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.username, ["minimanshoes"]);
  assert.equal(body.onlyPostsNewerThan, "2026-10-10");
});
