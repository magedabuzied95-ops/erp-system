#!/usr/bin/env node
/**
 * AI brain evaluation harness.
 *
 * Why this exists: of the 58 AI-related test files in this repo, every one asserts
 * structure or UI — none score an ANSWER. So there has never been a way to say
 * whether a prompt change, a model change or a retrieval change made the assistant
 * better or worse. Every improvement was a guess, and a regression was invisible
 * until a customer hit it.
 *
 * What it measures, per case:
 *   intent            — did the understanding pass read the right primary intent
 *   legacy_intent     — did the five-value enum the pipeline consumes stay correct
 *   entities          — precision/recall over the fields the case labels
 *   escalation        — did requires_human match, both directions
 *   retrieval         — was the expected product in the returned candidates
 *
 * Retrieval is scored against a STUB catalog by default, so the harness runs with no
 * database and no API key — that is what makes it usable in CI and on a laptop.
 * Point it at a real tenant with --tenant to score live retrieval instead.
 *
 * Usage:
 *   node server/scripts/evalAiBrain.js                     # golden set, offline
 *   node server/scripts/evalAiBrain.js --set path.json     # custom set
 *   node server/scripts/evalAiBrain.js --json              # machine-readable
 *   node server/scripts/evalAiBrain.js --baseline file     # fail on regression
 *
 * Exit code is non-zero when a baseline is supplied and any metric regressed, so this
 * can gate a deploy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDeterministicUnderstanding, understandCustomerMessage } from "../services/aiUnderstandingService.js";
import { searchProductsHybrid } from "../services/aiHybridProductSearchService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const DEFAULT_SET = path.join(repoRoot, "tests", "ai-brain", "golden-set.json");

const argOf = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const hasFlag = (flag) => process.argv.includes(flag);

const text = (value = "") => String(value ?? "").trim();

/**
 * Folds the Arabic spelling differences that carry no meaning, so a label written
 * "اسود" scores against an extractor that canonicalizes to "أسود". Without this the
 * harness reports entity failures that are purely orthographic.
 */
const foldArabic = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىي]/g, "ي")
    .replace(/[ً-ْ]/g, "")
    .replace(/^ال/, "");
const asArray = (value) => (Array.isArray(value) ? value : []);

/** Renders a metric value for the failure list, including object-valued ones. */
const describe = (value) => {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value)) return `[${value.join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .map(([field, item]) => `${field}:${item ?? "null"}`)
      .join(" ")}}`;
  }
  return String(value);
};

/**
 * Offline catalog. Small on purpose: the point is to score whether retrieval reaches
 * the RIGHT product among plausible distractors, not to mirror production data.
 */
const STUB_CATALOG = [
  { id: 1, name: "Crocs Classic Clog", product_type: "crocs", brand: "Crocs", price: 950, total_stock: 12 },
  { id: 2, name: "Crocs Bayaband", product_type: "crocs", brand: "Crocs", price: 1100, total_stock: 4 },
  { id: 3, name: "Nike Air Jordan 4 Retro", product_type: "sneakers", brand: "Nike", price: 4200, total_stock: 3 },
  { id: 4, name: "Nike Air Force 1", product_type: "sneakers", brand: "Nike", price: 2800, total_stock: 8 },
  { id: 5, name: "Adidas Ultraboost", product_type: "running", brand: "Adidas", price: 3200, total_stock: 6 },
  { id: 6, name: "Puma Suede Classic", product_type: "sneakers", brand: "Puma", price: 1900, total_stock: 5 },
  { id: 7, name: "Vans Old Skool", product_type: "sneakers", brand: "Vans", price: 1750, total_stock: 9 },
  { id: 8, name: "New Balance 574", product_type: "sneakers", brand: "New Balance", price: 2400, total_stock: 2 },
];

const stubSearch = ({ query }) => {
  const needle = text(query).toLowerCase();
  if (!needle) return [];
  return STUB_CATALOG.filter((product) =>
    `${product.name} ${product.brand} ${product.product_type}`.toLowerCase().includes(needle)
  );
};

const scoreEntities = (expected = {}, actual = {}) => {
  const labelled = Object.entries(expected).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!labelled.length) return { total: 0, correct: 0 };

  let correct = 0;
  for (const [field, value] of labelled) {
    const got = actual?.[field];
    if (got === null || got === undefined) continue;
    const expectedText = foldArabic(value);
    const gotText = foldArabic(got);
    // Substring either way: "كروكس" labelled against "كروكس اسود" is a hit, and a
    // model that returns the fuller phrase should not be punished for it.
    if (expectedText === gotText || gotText.includes(expectedText) || expectedText.includes(gotText)) correct += 1;
  }
  return { total: labelled.length, correct };
};

const evaluateCase = async (testCase, { tenantId, searchProducts }) => {
  const understanding = await understandCustomerMessage({
    tenantId,
    message: testCase.message,
    history: asArray(testCase.history),
    channel: testCase.channel || "eval",
  });

  const expected = testCase.expected || {};
  const results = {
    id: testCase.id,
    message: testCase.message,
    source: understanding.source,
  };

  if (expected.primary_intent) {
    results.intent = { expected: expected.primary_intent, actual: understanding.primary_intent };
    results.intent.pass = understanding.primary_intent === expected.primary_intent;
  }
  if (expected.legacy_intent) {
    results.legacy_intent = { expected: expected.legacy_intent, actual: understanding.legacy_intent };
    results.legacy_intent.pass = understanding.legacy_intent === expected.legacy_intent;
  }
  if (expected.entities) {
    const entityScore = scoreEntities(expected.entities, understanding.entities);
    results.entities = { ...entityScore, pass: entityScore.correct === entityScore.total };
  }
  if (expected.objection !== undefined) {
    // Scored separately from intent: a message can carry an objection while its primary
    // intent is something else, and the two are produced by different rule lists that
    // have drifted apart before. A case declaring an expected objection that nothing
    // asserts is a test that cannot fail.
    results.objection = { expected: expected.objection, actual: understanding.objection };
    results.objection.pass = understanding.objection === expected.objection;
  }
  if (expected.refers_to_previous) {
    // Multi-turn reference. Only the subfields a case names are compared, so a case can
    // pin is_followup without committing to a target.
    const wanted = expected.refers_to_previous;
    const got = understanding.refers_to_previous || {};
    const mismatches = Object.entries(wanted).filter(([field, value]) => got[field] !== value);
    results.reference = {
      expected: wanted,
      actual: { is_followup: got.is_followup, target: got.target },
      pass: mismatches.length === 0,
    };
  }
  if (expected.requires_human !== undefined) {
    results.escalation = { expected: expected.requires_human, actual: understanding.requires_human };
    results.escalation.pass = understanding.requires_human === expected.requires_human;
  }
  if (expected.product_id !== undefined) {
    const products = await searchProductsHybrid({
      tenantId,
      message: testCase.message,
      understanding,
      limit: 5,
      runQuery: searchProducts,
    }).catch(() => []);
    const ids = products.map((product) => String(product.id ?? product.product_id));
    results.retrieval = {
      expected: String(expected.product_id),
      returned: ids,
      // Rank matters: an answer buried at position 5 is not the same as position 1.
      rank: ids.indexOf(String(expected.product_id)) + 1,
    };
    results.retrieval.pass = results.retrieval.rank > 0;
  }

  return results;
};

const summarize = (results) => {
  const metric = (name) => {
    const scored = results.filter((result) => result[name] !== undefined);
    if (!scored.length) return null;
    const passed = scored.filter((result) => result[name].pass).length;
    return { scored: scored.length, passed, accuracy: Number((passed / scored.length).toFixed(3)) };
  };

  const entityCases = results.filter((result) => result.entities);
  const entityTotals = entityCases.reduce(
    (acc, result) => ({ total: acc.total + result.entities.total, correct: acc.correct + result.entities.correct }),
    { total: 0, correct: 0 }
  );

  const ranked = results.filter((result) => result.retrieval?.rank > 0).map((result) => result.retrieval.rank);

  return {
    cases: results.length,
    intent: metric("intent"),
    legacy_intent: metric("legacy_intent"),
    objection: metric("objection"),
    reference: metric("reference"),
    escalation: metric("escalation"),
    retrieval: metric("retrieval"),
    entity_field_accuracy: entityTotals.total
      ? Number((entityTotals.correct / entityTotals.total).toFixed(3))
      : null,
    retrieval_mean_rank: ranked.length ? Number((ranked.reduce((a, b) => a + b, 0) / ranked.length).toFixed(2)) : null,
  };
};

const compareToBaseline = (summary, baseline) => {
  const regressions = [];
  for (const key of ["intent", "legacy_intent", "objection", "reference", "escalation", "retrieval"]) {
    const now = summary[key]?.accuracy;
    const before = baseline[key]?.accuracy;
    if (typeof now === "number" && typeof before === "number" && now < before) {
      regressions.push(`${key}: ${before} -> ${now}`);
    }
  }
  if (
    typeof summary.entity_field_accuracy === "number" &&
    typeof baseline.entity_field_accuracy === "number" &&
    summary.entity_field_accuracy < baseline.entity_field_accuracy
  ) {
    regressions.push(`entity_field_accuracy: ${baseline.entity_field_accuracy} -> ${summary.entity_field_accuracy}`);
  }
  return regressions;
};

const main = async () => {
  const setPath = argOf("--set", DEFAULT_SET);
  if (!fs.existsSync(setPath)) {
    console.error(`golden set not found: ${setPath}`);
    process.exit(2);
  }

  const cases = JSON.parse(fs.readFileSync(setPath, "utf8"));
  const tenantArg = argOf("--tenant", "");
  const tenantId = tenantArg ? Number(tenantArg) : null;

  let searchProducts = stubSearch;
  if (tenantId) {
    const { searchAiSalesProducts } = await import("../services/aiSalesAgentService.js");
    searchProducts = ({ query, limit }) => searchAiSalesProducts({ tenantId, query, limit });
  }

  // The services under evaluation log to stdout. In --json mode that lands in the
  // middle of the document and makes the output unparseable — redirecting it to a
  // baseline file produced a corrupt file rather than an obvious error. Diagnostics
  // are kept, just moved to stderr, so stdout carries only the JSON.
  const restoreLog = console.log;
  if (hasFlag("--json")) console.log = (...args) => console.error(...args);

  const results = [];
  try {
    for (const testCase of cases) {
      results.push(await evaluateCase(testCase, { tenantId, searchProducts }));
    }
  } finally {
    console.log = restoreLog;
  }
  const summary = summarize(results);
  // Whether the understanding pass actually ran matters for reading the numbers: a
  // deterministic run scores the keyword baseline, not the model.
  summary.understanding_source = results.every((result) => result.source === "deterministic")
    ? "deterministic"
    : "model";

  if (hasFlag("--json")) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log(`\nAI brain eval — ${summary.cases} cases (understanding: ${summary.understanding_source})\n`);
    const row = (label, metric) =>
      metric ? `  ${label.padEnd(22)} ${String(metric.passed).padStart(3)}/${String(metric.scored).padEnd(3)}  ${(metric.accuracy * 100).toFixed(1)}%` : null;
    [
      row("primary intent", summary.intent),
      row("legacy intent", summary.legacy_intent),
      row("objection", summary.objection),
      row("reference", summary.reference),
      row("escalation", summary.escalation),
      row("retrieval hit", summary.retrieval),
    ]
      .filter(Boolean)
      .forEach((line) => console.log(line));
    if (summary.entity_field_accuracy !== null) {
      console.log(`  ${"entity fields".padEnd(22)}        ${(summary.entity_field_accuracy * 100).toFixed(1)}%`);
    }
    if (summary.retrieval_mean_rank !== null) {
      console.log(`  ${"retrieval mean rank".padEnd(22)}        ${summary.retrieval_mean_rank}`);
    }

    const failures = results.filter((result) =>
      ["intent", "legacy_intent", "objection", "reference", "escalation", "retrieval", "entities"].some((key) => result[key] && !result[key].pass)
    );
    if (failures.length) {
      console.log(`\n  ${failures.length} case(s) with at least one miss:`);
      for (const failure of failures.slice(0, 15)) {
        const misses = ["intent", "legacy_intent", "objection", "reference", "escalation", "retrieval", "entities"]
          .filter((key) => failure[key] && !failure[key].pass)
          .map((key) =>
            key === "entities"
              ? `entities ${failure.entities.correct}/${failure.entities.total}`
              // Object-valued metrics (reference) must render their fields, not
              // "[object Object]≠[object Object]" — a failure nobody can act on is
              // barely better than no failure at all.
              : `${key} ${describe(failure[key].expected)}≠${describe(failure[key].actual ?? failure[key].returned)}`
          );
        console.log(`    [${failure.id}] ${failure.message.slice(0, 48)} — ${misses.join(", ")}`);
      }
    }
    console.log("");
  }

  const baselinePath = argOf("--baseline", "");
  if (baselinePath) {
    if (hasFlag("--write-baseline")) {
      fs.writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      console.log(`baseline written: ${baselinePath}`);
      return;
    }
    if (!fs.existsSync(baselinePath)) {
      console.error(`baseline not found: ${baselinePath} (create it with --write-baseline)`);
      process.exit(2);
    }
    const regressions = compareToBaseline(summary, JSON.parse(fs.readFileSync(baselinePath, "utf8")));
    if (regressions.length) {
      console.error(`REGRESSION vs baseline:\n  ${regressions.join("\n  ")}`);
      process.exit(1);
    }
    console.log("no regression vs baseline");
  }
};

main().catch((error) => {
  console.error("eval failed:", error?.message);
  process.exit(2);
});
