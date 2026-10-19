#!/usr/bin/env node
/**
 * Photo-search evaluation: did the right stocked shoe come back?
 *
 * Runs recogniseProductFromImage (the exact function WhatsApp and the AI inbox call) on every case
 * in server/scripts/visual-eval/manifest.json and scores what it returned against the label.
 *
 * Per case it records what the customer would have been told:
 *   first   — the product of the first card (matched only)
 *   cards   — every product the reply could show: the matched product, or, when nothing was named,
 *             the closest-brand shortlist + the stocked family the photo was read as
 *             (the brain answers "عندكم terrex؟" with those)
 *   said    — "same" | "same_model_other_color" | "closest" | "miss"
 *
 * Metrics (over cases whose expected product is stocked, unless said otherwise):
 *   hit@1             first card's product is an expected one
 *   hit@cards         any product the reply could show is an expected one
 *   colour_first      hit@1 AND the first card's colour is the expected colour (cases with one)
 *   honest_miss       we said "not found / can't tell"; on unstocked cases that is the RIGHT answer
 *   wrong_confident   we said "same" (not "closest") and the product was not an expected one
 *                     (over ALL cases — unstocked ones included)
 *   latency, OpenAI calls per case (every request to api.openai.com, counted at fetch)
 *
 * Runs INSIDE the backend container, against the production database, READ-ONLY: every
 * INSERT/UPDATE/DELETE/ALTER/CREATE the services would issue is dropped before it reaches Postgres
 * (the visual search runs an idempotent schema "ensure" on each call). Never run it against the
 * live /app directory — use a throwaway copy (see visual-eval/README.md).
 *
 * Usage (from the copied server root, i.e. the dir holding ./uploads):
 *   node scripts/visualSearchEval.js --tenant 1 [--only owner_test] [--limit 5] [--out file.json]
 *        [--concurrency 2] [--yes] [--dump-images dir] [--manifest path]
 */
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";

import { screenshotLike } from "./visual-eval/screenshotAugment.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const parseArgs = (argv) => {
  const args = { only: "", limit: 0, out: "", concurrency: 2, yes: false, tenant: "", manifest: path.join(here, "visual-eval", "manifest.json"), dumpImages: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === "--only") args.only = next();
    else if (flag === "--limit") args.limit = Number(next()) || 0;
    else if (flag === "--out") args.out = next();
    else if (flag === "--concurrency") args.concurrency = Math.max(1, Number(next()) || 1);
    else if (flag === "--yes" || flag === "-y") args.yes = true;
    else if (flag === "--tenant") args.tenant = next();
    else if (flag === "--manifest") args.manifest = next();
    else if (flag === "--dump-images") args.dumpImages = next();
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
};

// ---------------------------------------------------------------------------------------------
// Network accounting. Patched before any service is imported, so the OpenAI SDK (which calls the
// global fetch) and the compatible vision provider are both seen. Attributed per case through
// AsyncLocalStorage, so --concurrency does not mix counts.
// ---------------------------------------------------------------------------------------------
const caseContext = new AsyncLocalStorage();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const store = caseContext.getStore();
  if (store) {
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      host = "unknown";
    }
    if (host === "api.openai.com") {
      store.openai += 1;
      const endpoint = new URL(url).pathname.replace(/^\/v1\//, "");
      store.openaiEndpoints[endpoint] = (store.openaiEndpoints[endpoint] || 0) + 1;
    } else {
      store.otherHosts[host] = (store.otherHosts[host] || 0) + 1;
    }
  }
  return originalFetch(input, init);
};

const MUTATING_SQL = /^\s*(?:with\b[\s\S]*?\b)?(insert|update|delete|alter|create|drop|truncate|grant|revoke|comment|vacuum|reindex)\b/i;
let blockedWrites = 0;
const guardDbReadOnly = (db) => {
  const original = db.query.bind(db);
  db.query = (...args) => {
    const sql = typeof args[0] === "string" ? args[0] : text(args[0]?.text);
    if (MUTATING_SQL.test(sql)) {
      blockedWrites += 1;
      const empty = { rows: [], rowCount: 0, command: "SKIPPED_BY_EVAL" };
      const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
      if (callback) return callback(null, empty);
      return Promise.resolve(empty);
    }
    return original(...args);
  };
};

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
const asArray = (value) => (Array.isArray(value) ? value : []);
const ids = (list) => asArray(list).map((value) => String(value)).filter(Boolean);
const normColour = (value) => text(value).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

// Colour names in the catalogue are free text ("Black/White", "اسود", "Core Black"): a match is
// either name containing the other, word-wise.
export const colourMatches = (got = "", expected = "") => {
  const a = normColour(got);
  const b = normColour(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  const aw = new Set(a.split(" "));
  const bw = b.split(" ");
  return bw.every((word) => aw.has(word)) || a.split(" ").every((word) => new Set(bw).has(word));
};

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/**
 * Bytes for an image reference:
 *   "uploads:whatsapp-media/x.jpg"   a file under ./uploads of the server root (cwd)
 *   "https://…/uploads/…"            our own upload: read off disk when present, else fetched
 *   "https://…"                      fetched
 *   "images/x.jpg" / absolute path   relative to the manifest folder
 */
const readImageRef = async (ref = "", { manifestDir }) => {
  const value = text(ref);
  if (!value) throw new Error("empty image ref");
  if (value.startsWith("uploads:")) {
    const filePath = path.resolve(process.cwd(), "uploads", value.slice("uploads:".length).replace(/^\/+/, ""));
    return { buffer: fs.readFileSync(filePath), mimeType: MIME[path.extname(filePath).toLowerCase()] || "image/jpeg" };
  }
  // The index stores our own photos as bare "/uploads/products/…" paths.
  if (value.startsWith("/uploads/")) {
    const local = path.resolve(process.cwd(), `.${decodeURIComponent(value)}`);
    return { buffer: fs.readFileSync(local), mimeType: MIME[path.extname(local).toLowerCase()] || "image/jpeg" };
  }
  if (/^https?:\/\//i.test(value)) {
    const { pathname } = new URL(value);
    if (pathname.startsWith("/uploads/")) {
      const local = path.resolve(process.cwd(), `.${decodeURIComponent(pathname)}`);
      if (fs.existsSync(local)) return { buffer: fs.readFileSync(local), mimeType: MIME[path.extname(local).toLowerCase()] || "image/jpeg" };
    }
    const response = await originalFetch(value);
    if (!response.ok) throw new Error(`fetch ${response.status} ${value}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || "image/jpeg" };
  }
  const filePath = path.isAbsolute(value) ? value : path.resolve(manifestDir, value);
  return { buffer: fs.readFileSync(filePath), mimeType: MIME[path.extname(filePath).toLowerCase()] || "image/jpeg" };
};

// A case's query image: its own file, or (synthetic) its source photo through the screenshot recipe.
export const caseImage = async (entry, { manifestDir }) => {
  if (entry.image) return readImageRef(entry.image, { manifestDir });
  if (entry.source && entry.augment) {
    const source = await readImageRef(entry.source, { manifestDir });
    const { buffer, mimeType } = await screenshotLike(source.buffer, entry.augment);
    return { buffer, mimeType };
  }
  if (entry.source) return readImageRef(entry.source, { manifestDir });
  throw new Error(`case ${entry.id} has no image`);
};

// What the reply would say, read off the recogniser's result.
export const summariseResult = (result = {}) => {
  const matched = Boolean(result?.matched);
  const firstCard = asArray(result?.productCards)[0] || null;
  const first = matched ? text(result?.productId) : "";
  const said = !matched
    ? "miss"
    : result?.photoMatch
      ? result.photoMatch
      : result?.closest
        ? "closest"
        : "same";
  const cards = matched
    ? [first]
    : [...new Set([...asArray(result?.candidates).map((item) => text(item?.product_id)), ...ids(result?.modelProductIds)].filter(Boolean))];
  return {
    matched,
    said,
    reason: text(result?.reason),
    first,
    first_color: text(firstCard?.color || result?.matchedColor),
    cards,
    model_query: text(result?.modelQuery),
    vision: {
      brand: text(result?.understanding?.detected?.brand_guess),
      model: text(result?.understanding?.detected?.model_guess),
      provider: text(result?.understanding?.vision_provider || "openai"),
    },
    searched_indexed_images: Number(result?.search?.searchedCount || 0),
    top_matches: asArray(result?.search?.topMatches).slice(0, 5).map((row) => ({
      product_id: text(row?.product_id),
      color: text(row?.color),
      score: Math.round(Number(row?.score ?? row?.finalScore ?? 0) * 1000) / 1000,
    })),
  };
};

export const scoreCase = (entry = {}, summary = {}) => {
  const expected = ids(entry.expected_product_ids);
  const stocked = expected.length > 0;
  const hit1 = stocked && summary.matched && expected.includes(summary.first);
  const hitCards = stocked && summary.cards.some((id) => expected.includes(id));
  const colourFirst = entry.expected_color ? hit1 && colourMatches(summary.first_color, entry.expected_color) : null;
  const saidSame = summary.matched && summary.said !== "closest";
  const wrongConfident = saidSame && !expected.includes(summary.first);
  return { stocked, hit1, hitCards, colourFirst, honestMiss: !summary.matched, wrongConfident };
};

const pct = (num, den) => (den ? `${((100 * num) / den).toFixed(1)}%` : "—");

export const aggregate = (rows = []) => {
  const stocked = rows.filter((row) => row.score?.stocked && !row.error);
  const unstocked = rows.filter((row) => row.score && !row.score.stocked && !row.error);
  const scored = rows.filter((row) => row.score && !row.error);
  const withColour = stocked.filter((row) => row.score.colourFirst !== null);
  const sum = (list, key) => list.reduce((total, row) => total + (row.score[key] ? 1 : 0), 0);
  const latency = scored.map((row) => row.ms);
  const calls = scored.map((row) => row.openai_calls);
  return {
    cases: rows.length,
    errors: rows.filter((row) => row.error).length,
    stocked_cases: stocked.length,
    unstocked_cases: unstocked.length,
    hit_at_1: { n: sum(stocked, "hit1"), of: stocked.length, rate: pct(sum(stocked, "hit1"), stocked.length) },
    hit_at_cards: { n: sum(stocked, "hitCards"), of: stocked.length, rate: pct(sum(stocked, "hitCards"), stocked.length) },
    colour_first: { n: sum(withColour, "colourFirst"), of: withColour.length, rate: pct(sum(withColour, "colourFirst"), withColour.length) },
    miss_on_stocked: { n: sum(stocked, "honestMiss"), of: stocked.length, rate: pct(sum(stocked, "honestMiss"), stocked.length) },
    honest_miss_on_unstocked: { n: sum(unstocked, "honestMiss"), of: unstocked.length, rate: pct(sum(unstocked, "honestMiss"), unstocked.length) },
    wrong_confident: { n: sum(scored, "wrongConfident"), of: scored.length, rate: pct(sum(scored, "wrongConfident"), scored.length) },
    mean_latency_ms: latency.length ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : 0,
    openai_calls_per_case: calls.length ? Math.round((100 * calls.reduce((a, b) => a + b, 0)) / calls.length) / 100 : 0,
  };
};

const sliceKey = (row) => (row.slice ? `${row.kind}/${row.slice}` : row.kind);

const printTable = (groups) => {
  const header = ["slice", "cases", "hit@1", "hit@cards", "colour 1st", "miss(stocked)", "miss(unstocked)", "wrong-same", "ms", "openai/case"];
  const lines = Object.entries(groups).map(([name, m]) => [
    name,
    String(m.cases - m.errors) + (m.errors ? ` (+${m.errors} err)` : ""),
    `${m.hit_at_1.n}/${m.hit_at_1.of} ${m.hit_at_1.rate}`,
    `${m.hit_at_cards.n}/${m.hit_at_cards.of} ${m.hit_at_cards.rate}`,
    `${m.colour_first.n}/${m.colour_first.of} ${m.colour_first.rate}`,
    `${m.miss_on_stocked.n}/${m.miss_on_stocked.of}`,
    `${m.honest_miss_on_unstocked.n}/${m.honest_miss_on_unstocked.of}`,
    `${m.wrong_confident.n}/${m.wrong_confident.of} ${m.wrong_confident.rate}`,
    String(m.mean_latency_ms),
    String(m.openai_calls_per_case),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((line) => line[i].length)));
  const fmt = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const line of lines) console.log(fmt(line));
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 32).join("\n"));
    return;
  }
  const manifestPath = path.resolve(args.manifest);
  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const tenantId = text(args.tenant || process.env.AI_EVAL_TENANT_ID || manifest.tenant_id);
  if (!tenantId) throw new Error("no tenant: pass --tenant or set tenant_id in the manifest");

  let cases = asArray(manifest.cases);
  if (args.only) cases = cases.filter((entry) => args.only.split(",").includes(entry.kind));
  if (args.limit) cases = cases.slice(0, args.limit);

  const byKind = cases.reduce((acc, entry) => ({ ...acc, [entry.kind]: (acc[entry.kind] || 0) + 1 }), {});
  console.log(`[visual-eval] ${cases.length} case(s) ${JSON.stringify(byKind)} · tenant ${tenantId} · concurrency ${args.concurrency}`);
  console.log(`[visual-eval] each case = 1 vision read + usually 1 photo comparison (gpt-4o, low detail): ~${cases.length * 2} OpenAI calls`);
  if (!args.yes) {
    console.log("[visual-eval] starting in 5 s — Ctrl+C to stop (pass --yes to skip the wait)");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Imported only now: the fetch counter above must already be in place.
  const { default: db } = await import("../database/db.js");
  guardDbReadOnly(db);
  const { recogniseProductFromImage } = await import("../services/aiVisualProductRecognitionService.js");

  if (args.dumpImages) fs.mkdirSync(args.dumpImages, { recursive: true });

  const rows = new Array(cases.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < cases.length) {
      const index = nextIndex;
      nextIndex += 1;
      const entry = cases[index];
      const row = { id: entry.id, kind: entry.kind, slice: entry.slice || "", expected_product_ids: ids(entry.expected_product_ids), expected_color: text(entry.expected_color) };
      try {
        const image = await caseImage(entry, { manifestDir });
        if (args.dumpImages) fs.writeFileSync(path.join(args.dumpImages, `${entry.id}.jpg`), image.buffer);
        const store = { openai: 0, openaiEndpoints: {}, otherHosts: {} };
        const started = Date.now();
        const result = await caseContext.run(store, () =>
          recogniseProductFromImage({ tenantId, imageBuffer: image.buffer, mimeType: image.mimeType, requestId: `visual-eval:${entry.id}` })
        );
        row.ms = Date.now() - started;
        row.openai_calls = store.openai;
        row.openai_endpoints = store.openaiEndpoints;
        row.other_hosts = store.otherHosts;
        row.result = summariseResult(result);
        row.score = scoreCase(entry, row.result);
      } catch (error) {
        row.error = error?.message || String(error);
      }
      rows[index] = row;
      const mark = row.error ? "ERR " : row.score.hit1 ? "HIT " : row.score.hitCards ? "card" : row.score.stocked ? "MISS" : row.score.honestMiss ? "ok-0" : "FP  ";
      console.log(`[visual-eval] ${String(index + 1).padStart(3)}/${cases.length} ${mark} ${entry.id} → ${row.error || `${row.result.said} ${row.result.first || "-"} ${row.result.first_color || ""} (${row.ms} ms, ${row.openai_calls} openai)`}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, cases.length) }, worker));

  const groups = { ALL: aggregate(rows) };
  for (const key of [...new Set(rows.map((row) => row.kind))]) groups[key] = aggregate(rows.filter((row) => row.kind === key));
  for (const key of [...new Set(rows.filter((row) => row.slice).map(sliceKey))]) groups[key] = aggregate(rows.filter((row) => sliceKey(row) === key));

  console.log("");
  printTable(groups);
  console.log(`\n[visual-eval] writes the services tried and the eval dropped (read-only guard): ${blockedWrites}`);

  const out = args.out || path.join(manifestDir, "results", `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ ran_at: new Date().toISOString(), tenant_id: tenantId, manifest: path.relative(process.cwd(), manifestPath), args: { only: args.only, limit: args.limit }, blocked_writes: blockedWrites, metrics: groups, cases: rows }, null, 2));
  console.log(`[visual-eval] wrote ${out}`);
  await db.end?.().catch?.(() => {});
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error("[visual-eval] failed", error);
      process.exit(1);
    }
  );
}
