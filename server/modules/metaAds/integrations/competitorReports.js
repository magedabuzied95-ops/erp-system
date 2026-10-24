// "تقرير المنافسين الأسبوعي" — reads the competitor posts (and ads) of the last N days, asks
// the AI for strengths / weaknesses / what went viral / a 30-day content plan, saves the
// report and sends it to Telegram and / or email.
//
// A schedule row (meta_ads_competitor_report_schedules) says who receives it and on which
// weekday; the hourly job sends each due schedule once a week after REPORT_HOUR Cairo time.
// Without an AI provider the report still goes out with the numbers only.

import db from "../../../database/db.js";
import { zonedParts } from "../../../utils/appTimezone.js";
import { httpError } from "../metaAdsCore.js";
import { clip, log, text, warn } from "./integrationsCommon.js";

const REPORT_HOUR = 9;
const TELEGRAM_CHUNK = 3900;
const TOP_POSTS_PER_COMPETITOR = 5;

const pct = (value, total) => (total ? Math.round((value / total) * 100) : 0);
const num = (value) => Number(value) || 0;
const fmt = (value) => num(value).toLocaleString("en-US");

// Due = active, today is its weekday (Cairo), past the report hour, and nothing sent in 6 days.
export const isScheduleDue = (schedule = {}, now = new Date()) => {
  if (!schedule.active) return false;
  const parts = zonedParts(now);
  if (!parts || parts.weekday !== Number(schedule.weekday) || parts.hour < REPORT_HOUR) return false;
  if (!schedule.last_report_at) return true;
  return now.getTime() - new Date(schedule.last_report_at).getTime() > 6 * 86400000;
};

// Per-page numbers for the period: posts, average engagement, best format, posting rhythm, top posts.
export const summarizeCompetitor = (competitor, posts = [], days = 7) => {
  const total = posts.reduce((sum, post) => sum + num(post.engagement), 0);
  const byType = {};
  for (const post of posts) {
    const type = text(post.media_type) || "text";
    byType[type] ??= { posts: 0, engagement: 0 };
    byType[type].posts += 1;
    byType[type].engagement += num(post.engagement);
  }
  const formats = Object.entries(byType)
    .map(([type, value]) => ({ type, posts: value.posts, avg_engagement: Math.round(value.engagement / value.posts) }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement);
  const top = [...posts].sort((a, b) => num(b.engagement) - num(a.engagement)).slice(0, TOP_POSTS_PER_COMPETITOR);
  return {
    id: Number(competitor.id),
    name: text(competitor.name),
    is_own_page: Boolean(competitor.is_own_page),
    posts: posts.length,
    posts_per_week: Math.round((posts.length / Math.max(1, days)) * 7 * 10) / 10,
    total_engagement: total,
    avg_engagement: posts.length ? Math.round(total / posts.length) : 0,
    formats,
    top_posts: top.map((post) => ({
      url: text(post.url),
      media_type: text(post.media_type),
      posted_at: post.posted_at ? new Date(post.posted_at).toISOString().slice(0, 10) : "",
      likes: num(post.likes),
      comments: num(post.comments),
      shares: num(post.shares),
      views: num(post.views),
      engagement: num(post.engagement),
      text: clip(post.body, 280),
    })),
  };
};

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "competitors", "viral_content", "audience_insights", "recommendations", "plan_30_days"],
  properties: {
    overview: { type: "string" },
    competitors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "strengths", "weaknesses", "what_works"],
        properties: {
          name: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
          what_works: { type: "string" },
        },
      },
    },
    viral_content: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["competitor", "post_url", "why"],
        properties: { competitor: { type: "string" }, post_url: { type: "string" }, why: { type: "string" } },
      },
    },
    audience_insights: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    plan_30_days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "format", "idea", "hook"],
        properties: { day: { type: "integer" }, format: { type: "string" }, idea: { type: "string" }, hook: { type: "string" } },
      },
    },
  },
};

const INSTRUCTIONS = [
  "أنت خبير تسويق على السوشيال ميديا لمتجر مصري. هتاخد أرقام منشورات صفحات المنافسين على فيسبوك (وصفحة المتجر نفسه لو موجودة، معلّمة own_page) وإعلاناتهم الجديدة.",
  "اكتب بالعربي المصري البسيط وبصيغة JSON فقط:",
  "overview: ملخص الأسبوع في 3-4 جمل.",
  "competitors: لكل صفحة (غير صفحة المتجر) نقاط القوة ونقاط الضعف (2-4 لكل واحدة) و what_works: نوع المحتوى اللي بيجيب تفاعل عندهم.",
  "viral_content: أعلى 3-5 منشورات تفاعلًا ولماذا نجحت، مع رابط المنشور كما ورد.",
  "audience_insights: الجمهور بيتفاعل مع إيه (3-5 نقاط).",
  "recommendations: 3-6 خطوات عملية للمتجر، وقارن بأداء صفحة المتجر لو موجودة.",
  "plan_30_days: خطة محتوى 30 يوم بالظبط (day من 1 إلى 30) لكل يوم format (بوست صورة / ريلز / كاروسيل / ستوري / لايف) و idea و hook (أول جملة في المنشور).",
  "اعتمد على الأرقام فقط ولا تخترع أرقامًا.",
].join("\n");

const promptFor = (summaries, ads, days) =>
  JSON.stringify({
    period_days: days,
    pages: summaries,
    new_ads: ads.map((ad) => ({ competitor: ad.competitor_name, headline: clip(ad.headline, 140), angle: ad.ai_angle, offer: ad.ai_offer })),
  });

const runAnalysis = async (summaries, ads, days) => {
  const { resolveTextProvider, requestStructuredJson } = await import("../../../services/openaiProductDescriptionService.js");
  const provider = resolveTextProvider();
  if (!provider || provider.kind === "none") return null;
  return requestStructuredJson({
    provider,
    label: "meta-ads-competitor-report",
    instructions: INSTRUCTIONS,
    prompt: promptFor(summaries, ads, days),
    schemaName: "competitor_report",
    schema: ANALYSIS_SCHEMA,
    verbosity: "medium",
    maxTokens: 5000,
  });
};

const FORMAT_AR = { video: "فيديو", photo: "صورة", album: "ألبوم", link: "رابط", text: "نص" };
const bullets = (list = []) => list.filter((item) => text(item)).map((item) => `• ${text(item)}`);

// The report as plain text — the same text is stored, sent to Telegram and wrapped for email.
export const renderReportText = ({ title, summaries, analysis }) => {
  const lines = [`📊 ${title}`, ""];
  if (analysis?.overview) lines.push(text(analysis.overview), "");

  lines.push("📈 الأرقام");
  for (const item of summaries) {
    const best = item.formats[0];
    lines.push(
      `${item.is_own_page ? "🏠" : "🔹"} ${item.name}: ${item.posts} منشور (${item.posts_per_week}/أسبوع) — متوسط التفاعل ${fmt(item.avg_engagement)}` +
        (best ? ` — الأفضل: ${FORMAT_AR[best.type] || best.type}` : ""),
    );
  }
  lines.push("");

  const strengths = Array.isArray(analysis?.competitors) ? analysis.competitors : [];
  if (strengths.length) {
    lines.push("💪 نقاط القوة والضعف");
    for (const item of strengths) {
      lines.push(`— ${text(item.name)}`);
      if (item.strengths?.length) lines.push("  ✅ القوة:", ...bullets(item.strengths).map((line) => `  ${line}`));
      if (item.weaknesses?.length) lines.push("  ⚠️ الضعف:", ...bullets(item.weaknesses).map((line) => `  ${line}`));
      if (text(item.what_works)) lines.push(`  🎯 اللي شغال عندهم: ${text(item.what_works)}`);
    }
    lines.push("");
  }

  const viral = Array.isArray(analysis?.viral_content) && analysis.viral_content.length
    ? analysis.viral_content.map((item) => `🔥 ${text(item.competitor)}: ${text(item.why)}${text(item.post_url) ? `\n   ${text(item.post_url)}` : ""}`)
    : summaries
        .flatMap((item) => item.top_posts.slice(0, 1).map((post) => ({ ...post, name: item.name })))
        .sort((a, b) => b.engagement - a.engagement)
        .slice(0, 5)
        .map((post) => `🔥 ${post.name}: ${fmt(post.engagement)} تفاعل (${fmt(post.likes)} 👍 ${fmt(post.comments)} 💬 ${fmt(post.shares)} ↗️)${post.url ? `\n   ${post.url}` : ""}`);
  if (viral.length) lines.push("🚀 المحتوى اللي انتشر", ...viral, "");

  if (analysis?.audience_insights?.length) lines.push("👥 الجمهور بيتفاعل مع إيه", ...bullets(analysis.audience_insights), "");
  if (analysis?.recommendations?.length) lines.push("✅ تعمل إيه", ...bullets(analysis.recommendations), "");

  const plan = Array.isArray(analysis?.plan_30_days) ? [...analysis.plan_30_days].sort((a, b) => num(a.day) - num(b.day)) : [];
  if (plan.length) {
    lines.push("🗓️ خطة 30 يوم");
    for (const item of plan) lines.push(`يوم ${num(item.day)} — ${text(item.format)}: ${text(item.idea)}${text(item.hook) ? ` | «${text(item.hook)}»` : ""}`);
    lines.push("");
  }
  if (!analysis) lines.push("ℹ️ التحليل بالذكاء الاصطناعي غير متاح (لا يوجد مزود AI مضبوط على السيرفر) — التقرير فيه الأرقام فقط.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

// Telegram caps a message at 4096 characters; split on line breaks.
export const splitForTelegram = (value, size = TELEGRAM_CHUNK) => {
  const chunks = [];
  let current = "";
  for (const line of String(value || "").split("\n")) {
    const piece = line.length > size ? line.slice(0, size) : line;
    if (current && current.length + piece.length + 1 > size) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reportHtml = (title, body) =>
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
  `<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Tahoma,Arial,sans-serif">` +
  `<div style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;line-height:1.8;font-size:15px;color:#1a1a1a;white-space:pre-wrap" dir="rtl">` +
  `${escapeHtml(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div></body></html>`;

const emailList = (value) => text(value).split(/[,;\s]+/).filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item));

export const buildCompetitorReport = async (tenantId, { scheduleId = null, days = 7, now = new Date() } = {}) => {
  const windowDays = Math.min(90, Math.max(1, Number(days) || 7));
  const periodEnd = now;
  const periodStart = new Date(now.getTime() - windowDays * 86400000);
  const { rows: competitors } = await db.query(
    `SELECT id, name, is_own_page FROM meta_ads_competitors WHERE tenant_id = $1 AND active = TRUE ORDER BY is_own_page, name, id`,
    [tenantId],
  );
  if (!competitors.length) throw httpError(409, "Add at least one active competitor first.", "META_ADS_NO_COMPETITORS");
  const { rows: posts } = await db.query(
    `SELECT competitor_id, url, body, media_type, posted_at, likes, comments, shares, views, engagement
       FROM meta_ads_competitor_posts
      WHERE tenant_id = $1 AND COALESCE(posted_at, first_seen_at) >= $2 AND COALESCE(posted_at, first_seen_at) <= $3`,
    [tenantId, periodStart, periodEnd],
  );
  const { rows: ads } = await db.query(
    `SELECT co.name AS competitor_name, a.headline, a.ai_angle, a.ai_offer
       FROM meta_ads_competitor_ads a JOIN meta_ads_competitors co ON co.id = a.competitor_id AND co.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND a.first_seen_at >= $2 ORDER BY a.first_seen_at DESC LIMIT 30`,
    [tenantId, periodStart],
  );
  const summaries = competitors.map((competitor) =>
    summarizeCompetitor(competitor, posts.filter((post) => String(post.competitor_id) === String(competitor.id)), windowDays));

  let analysis = null;
  let aiError = null;
  if (posts.length || ads.length) {
    try {
      analysis = await runAnalysis(summaries, ads, windowDays);
    } catch (error) {
      aiError = clip(error?.message, 300);
      warn("competitor-report-ai", error, { tenant_id: tenantId });
    }
  }
  const title = `تقرير المنافسين — ${periodStart.toISOString().slice(0, 10)} إلى ${periodEnd.toISOString().slice(0, 10)}`;
  const reportText = renderReportText({ title, summaries, analysis });
  const { rows } = await db.query(
    `INSERT INTO meta_ads_competitor_reports (tenant_id, schedule_id, title, period_start, period_end, status, competitors_count, posts_count,
       summary, report_text, report, delivery_error)
     VALUES ($1,$2,$3,$4,$5,'ready',$6,$7,$8,$9,$10::jsonb,$11) RETURNING id`,
    [
      tenantId, scheduleId, title, periodStart, periodEnd, competitors.length, posts.length,
      clip(analysis?.overview, 2000) || null, reportText,
      JSON.stringify({ summaries, analysis, new_ads: ads.length, ai_error: aiError }),
      aiError ? `AI: ${aiError}` : null,
    ],
  );
  log("competitor-report", { tenant_id: tenantId, report: rows[0].id, competitors: competitors.length, posts: posts.length, ai: Boolean(analysis) });
  return { id: Number(rows[0].id), posts: posts.length, competitors: competitors.length, ai: Boolean(analysis) };
};

// Sends a saved report to the schedule's Telegram chat and / or email list.
export const deliverCompetitorReport = async (tenantId, reportId, { telegramChatId, emailTo } = {}) => {
  const { rows } = await db.query(
    `SELECT r.*, s.telegram_chat_id, s.email_to FROM meta_ads_competitor_reports r
       LEFT JOIN meta_ads_competitor_report_schedules s ON s.id = r.schedule_id AND s.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND r.id = $2`,
    [tenantId, Number(reportId) || 0],
  );
  const report = rows[0];
  if (!report) throw httpError(404, "Report not found");
  const chatId = text(telegramChatId ?? report.telegram_chat_id);
  const emails = emailList(emailTo ?? report.email_to);
  if (!chatId && !emails.length) throw httpError(409, "Add a Telegram chat id or an email to the report schedule first.", "REPORT_RECIPIENTS_MISSING");

  const errors = [];
  let telegram = false;
  let email = false;
  if (chatId) {
    try {
      const { sendTelegramText } = await import("../../../services/telegramBotService.js");
      for (const chunk of splitForTelegram(report.report_text)) await sendTelegramText({ chatId, messageText: chunk });
      telegram = true;
    } catch (error) {
      errors.push(`Telegram: ${clip(error?.message, 200)}`);
    }
  }
  if (emails.length) {
    try {
      const { sendSmtpMail } = await import("../../../services/staffTaskEmailNotificationService.js");
      for (const to of emails) await sendSmtpMail({ to, subject: report.title, text: report.report_text, html: reportHtml(report.title, report.report_text) });
      email = true;
    } catch (error) {
      errors.push(`Email: ${clip(error?.message, 200)}`);
    }
  }
  await db.query(
    `UPDATE meta_ads_competitor_reports SET
       sent_telegram_at = CASE WHEN $3 THEN NOW() ELSE sent_telegram_at END,
       sent_email_at = CASE WHEN $4 THEN NOW() ELSE sent_email_at END,
       status = CASE WHEN $3 OR $4 THEN 'sent' ELSE 'failed' END,
       delivery_error = $5
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, report.id, telegram, email, errors.length ? errors.join(" | ") : null],
  );
  if (!telegram && !email) throw httpError(502, errors.join(" | ") || "The report could not be sent.", "META_ADS_REPORT_NOT_SENT");
  return { telegram, email, errors };
};

// Build + send for one schedule (the "generate now" button and the weekly job). Once a report
// is built the schedule counts as done for the week even if sending fails, so the hourly job
// never rebuilds (and re-pays the AI for) the same report; "send" on the report retries delivery.
export const runReportSchedule = async (tenantId, scheduleId) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_competitor_report_schedules WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(scheduleId) || 0]);
  const schedule = rows[0];
  if (!schedule) throw httpError(404, "Report schedule not found");
  let report;
  try {
    report = await buildCompetitorReport(tenantId, { scheduleId: schedule.id, days: schedule.days_window });
  } catch (error) {
    await db.query(
      `UPDATE meta_ads_competitor_report_schedules SET last_error = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, schedule.id, clip(error?.message, 500)],
    );
    throw error;
  }
  let delivery = null;
  let deliveryError = null;
  if (text(schedule.telegram_chat_id) || emailList(schedule.email_to).length) {
    try {
      delivery = await deliverCompetitorReport(tenantId, report.id);
      if (delivery.errors.length) deliveryError = delivery.errors.join(" | ");
    } catch (error) {
      deliveryError = clip(error?.message, 500);
    }
  }
  await db.query(
    `UPDATE meta_ads_competitor_report_schedules SET last_report_at = NOW(), last_error = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, schedule.id, deliveryError],
  );
  return { ...report, delivery, delivery_error: deliveryError };
};
