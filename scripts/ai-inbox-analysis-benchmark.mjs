#!/usr/bin/env node
/*
 * What the AI Inbox analysis layer actually says, and how fast.
 *
 * The layer sat behind AI_ENABLED=false since it was written, so "is it any
 * good" had no answer — only 15k lines of TypeScript and an opinion. This runs
 * it over a fixed set of conversations written the way Egyptian customers write
 * and prints what it concludes, so the keep-or-delete decision is made from
 * output rather than from line count.
 *
 *   node scripts/ai-inbox-analysis-benchmark.mjs
 *   node scripts/ai-inbox-analysis-benchmark.mjs --json
 *
 * Fixtures are labelled with what a human would say, and the run reports
 * agreement. It is a smoke gauge, not a benchmark: twelve conversations cannot
 * measure accuracy. Its job is to make a regression or a blind spot visible.
 */
import { analysisInput, buildOrchestrator, closeAiEngines, inboxEngines, loadAiEngines } from "../tests/helpers/loadAiEngines.mjs";

const at = (minutesAgo) => new Date(Date.UTC(2026, 7, 21, 12, 0, 0) - minutesAgo * 60000).toISOString();
const c = (text, minutesAgo) => ({ role: "customer", text, created_at: at(minutesAgo) });
const s = (text, minutesAgo) => ({ role: "staff", text, created_at: at(minutesAgo) });

const FIXTURES = [
  {
    name: "ready to buy",
    expect: { stage: "Ready To Buy", priorityIn: ["High", "Critical"] },
    messages: [c("السلام عليكم", 30), s("أهلاً بيك", 29), c("عندكم الحذاء الأسود مقاس 43؟", 28), s("أيوة متوفر", 27), c("تمام هاخده، ابعتلي العنوان", 3)],
  },
  {
    name: "price objection",
    expect: { mood: "Price Sensitive", objection: "Price" },
    messages: [c("بكام الجزمة دي؟", 20), s("٩٥٠ جنيه", 19), c("غالية أوي، مفيش خصم؟", 18)],
  },
  {
    name: "late order complaint",
    expect: { mood: "Angry", intent: "Complaint", priorityIn: ["Critical", "High"] },
    messages: [c("الأوردر اتأخر أسبوع وحد مردش عليا", 90), c("ده كلام يتقال؟ عايز أرجع المنتج", 89)],
  },
  {
    name: "just browsing",
    expect: { notStage: "Ready To Buy" },
    messages: [c("عندكم شنط؟", 15), s("أيوة", 14), c("طب شكرا هبص وارجعلك", 13)],
  },
  {
    name: "size availability",
    expect: { intent: "Size Inquiry" },
    messages: [c("فيه المقاس ٤٤ من الموديل ده؟", 10)],
  },
  {
    name: "delivery question",
    expect: { intent: "Delivery" },
    messages: [c("التوصيل بياخد كام يوم؟", 8)],
  },
  {
    name: "exchange request",
    expect: { intent: "Exchange" },
    messages: [c("المقاس مش مظبوط، عايز أستبدله", 60)],
  },
  {
    name: "trust objection",
    expect: { objection: "Trust" },
    messages: [c("ده أصلي ولا تقليد؟", 12)],
  },
  {
    name: "payment question",
    expect: { intent: "Payment" },
    messages: [c("بتقبلوا فيزا ولا كاش بس؟", 7)],
  },
  {
    name: "silence after a quote",
    expect: { notStage: "Ready To Buy" },
    messages: [c("بكام؟", 4000), s("٧٥٠ جنيه", 3999)],
  },
  {
    name: "empty thread",
    expect: {},
    messages: [],
  },
  {
    name: "malformed history",
    expect: {},
    messages: [null, {}, { role: "customer" }, c("عايز اشتري", 2)],
  },
];

const engines = await loadAiEngines();
const orchestrator = buildOrchestrator(inboxEngines(engines), engines);

const rows = [];
for (const fixture of FIXTURES) {
  const started = performance.now();
  const analysis = await orchestrator.analyze(analysisInput({ messages: fixture.messages }));
  const elapsed = performance.now() - started;
  const intelligence = analysis.conversation || {};
  const checks = [];
  if (fixture.expect.stage) checks.push([`stage=${fixture.expect.stage}`, intelligence.salesStage === fixture.expect.stage]);
  if (fixture.expect.notStage) checks.push([`stage!=${fixture.expect.notStage}`, intelligence.salesStage !== fixture.expect.notStage]);
  if (fixture.expect.mood) checks.push([`mood=${fixture.expect.mood}`, intelligence.customerMood === fixture.expect.mood]);
  if (fixture.expect.intent) checks.push([`intent∋${fixture.expect.intent}`, (intelligence.intent || []).includes(fixture.expect.intent)]);
  if (fixture.expect.objection) checks.push([`objection∋${fixture.expect.objection}`, (intelligence.objections || []).includes(fixture.expect.objection)]);
  if (fixture.expect.priorityIn) checks.push([`priority∈${fixture.expect.priorityIn}`, fixture.expect.priorityIn.includes(intelligence.priority)]);
  rows.push({
    name: fixture.name,
    ms: Math.round(elapsed * 10) / 10,
    errors: analysis.errors?.length || 0,
    mood: intelligence.customerMood,
    stage: intelligence.salesStage,
    priority: intelligence.priority,
    leadScore: intelligence.leadScore,
    intent: intelligence.intent,
    objections: intelligence.objections,
    checks,
  });
}

await closeAiEngines();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = (value, width) => String(value ?? "").padEnd(width);
  console.log(pad("conversation", 24) + pad("mood", 16) + pad("stage", 14) + pad("prio", 10) + pad("score", 7) + pad("ms", 7) + "checks");
  console.log("-".repeat(100));
  for (const row of rows) {
    const failed = row.checks.filter(([, ok]) => !ok);
    const summary = row.checks.length ? (failed.length ? `MISS ${failed.map(([label]) => label).join(", ")}` : "ok") : "-";
    console.log(pad(row.name, 24) + pad(row.mood, 16) + pad(row.stage, 14) + pad(row.priority, 10) + pad(row.leadScore, 7) + pad(row.ms, 7) + summary);
  }
  const totalChecks = rows.reduce((sum, row) => sum + row.checks.length, 0);
  const passed = rows.reduce((sum, row) => sum + row.checks.filter(([, ok]) => ok).length, 0);
  const errored = rows.filter((row) => row.errors > 0);
  const times = rows.map((row) => row.ms).sort((a, b) => a - b);
  console.log("-".repeat(100));
  console.log(`labelled expectations met: ${passed}/${totalChecks}`);
  console.log(`conversations with engine errors: ${errored.length}${errored.length ? ` (${errored.map((r) => r.name).join(", ")})` : ""}`);
  console.log(`analysis time: median ${times[Math.floor(times.length / 2)]}ms, slowest ${times.at(-1)}ms`);
  console.log("\nIntents and objections per conversation:");
  for (const row of rows) console.log(`  ${pad(row.name, 24)} ${JSON.stringify(row.intent)} ${JSON.stringify(row.objections)}`);
}
