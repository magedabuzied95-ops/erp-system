#!/usr/bin/env node
/**
 * Writes the "synthetic_screenshot" cases of manifest.json from REAL stocked product photos.
 *
 * For each popular model (Air Force 1, Jordan 4, Superstar, Samba, Terrex, …) it picks in-stock
 * products that have indexed photos with a colour, and adds cases per product + colour:
 *   slice "exact_image"      the query is screenshotLike(photo A) — A itself is in the image index
 *   slice "different_image"  the query is screenshotLike(photo B), a SECOND photo of the same
 *                            product + colour (also indexed: every catalogue photo is). Only when
 *                            one exists; otherwise another product of the model gets a case.
 * The expected answer is that product, that colour. Nothing is written but the manifest: an entry
 * is { source, augment: { seed } } and visualSearchEval.js renders it on the fly, byte-identical.
 *
 * Read-only against the database. Run from the server root (inside the container copy):
 *   node scripts/visual-eval/buildSyntheticCases.js --tenant 1 [--per-model 2] [--dump dir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { screenshotLike } from "./screenshotAugment.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Postgres regexes over lower(product name). Order = priority; the first 20 with stock are used.
export const POPULAR_MODELS = [
  ["af1", "air ?force|\\maf ?1\\M"],
  ["jordan4", "jordan ?4|\\maj ?4\\M|retro ?4"],
  ["jordan1", "jordan ?1\\M|\\maj ?1\\M"],
  ["superstar", "superstar"],
  ["samba", "samba"],
  ["terrex", "terrex"],
  ["ultraboost", "ultra ?boost"],
  ["campus", "campus"],
  ["yeezy", "yeezy"],
  ["newbalance", "new ?balance|\\mnb ?[0-9]|\\m(530|550|574|327|9060|2002r?)\\M"],
  ["skechers", "skechers"],
  ["gazelle", "gazelle"],
  ["forum", "forum"],
  ["stansmith", "stan ?smith"],
  ["dunk", "dunk"],
  ["airmax", "air ?max"],
  ["crocs", "crocs"],
  ["vans", "vans|old ?skool"],
  ["converse", "converse|chuck|all ?star"],
  ["asics", "asics|\\mgel\\M"],
  ["nmd", "\\mnmd"],
  ["puma", "puma"],
  ["salomon", "salomon|xt-?6"],
  ["lacoste", "lacoste"],
  ["hoka", "hoka"],
  ["saucony", "saucony"],
  ["reebok", "reebok"],
  ["adistar", "adistar"],
  ["louisvuitton", "louis ?vuitton|\\mlv\\M"],
  ["nikerunning", "nike (running|zoom)"],
  ["timberland", "timberland"],
  ["fila", "\\mfila\\M"],
];

const parseArgs = (argv) => {
  const args = { tenant: "", perModel: 2, models: 20, manifest: path.join(here, "manifest.json"), dump: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--tenant") args.tenant = argv[++i];
    else if (flag === "--per-model") args.perModel = Number(argv[++i]) || 2;
    else if (flag === "--models") args.models = Number(argv[++i]) || 20;
    else if (flag === "--manifest") args.manifest = argv[++i];
    else if (flag === "--dump") args.dump = argv[++i];
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
};

const seedFor = (value = "") => {
  let hash = 2166136261;
  for (const ch of String(value)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return hash || 1;
};

const SQL = `
  SELECT p.id AS product_id, p.name,
         lower(trim(idx.color)) AS color_key,
         min(idx.color) AS color,
         array_agg(DISTINCT idx.image_url) AS images,
         (SELECT COALESCE(sum(GREATEST(v.stock, 0)), 0) FROM product_variants v
           WHERE v.product_id = p.id AND v.deleted_at IS NULL AND COALESCE(v.is_active, TRUE)
             AND lower(trim(v.color)) = lower(trim(min(idx.color)))) AS colour_stock
  FROM ai_product_image_visual_index idx
  JOIN products p ON p.id = idx.product_id AND p.tenant_id = idx.tenant_id
  WHERE idx.tenant_id = $1::bigint
    AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') = 'active'
    AND COALESCE(p.is_active, TRUE) = TRUE
    AND lower(p.name) ~ $2
    AND NULLIF(trim(idx.color), '') IS NOT NULL
  GROUP BY p.id, p.name, lower(trim(idx.color))
  ORDER BY p.id DESC
`;

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(args.manifest);
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { cases: [] };
  const tenantId = String(args.tenant || manifest.tenant_id || "");
  if (!tenantId) throw new Error("no tenant: pass --tenant");
  const { default: db } = await import("../../database/db.js");
  const { readLocalUploadImage } = await import("../../services/aiVisualProductRecognitionService.js");

  const cases = [];
  let modelsUsed = 0;
  for (const [key, pattern] of POPULAR_MODELS) {
    if (modelsUsed >= args.models) break;
    const { rows } = await db.query(SQL, [tenantId, pattern]);
    const stocked = rows.filter((row) => Number(row.colour_stock) > 0 && row.images?.length);
    if (!stocked.length) {
      console.log(`[synthetic] ${key}: nothing stocked with a coloured indexed photo`);
      continue;
    }
    modelsUsed += 1;
    // One colour per product (the one with most photos), products with a second photo first.
    const perProduct = new Map();
    for (const row of stocked) {
      const current = perProduct.get(row.product_id);
      if (!current || row.images.length > current.images.length) perProduct.set(row.product_id, row);
    }
    const ordered = [...perProduct.values()].sort((a, b) => (b.images.length >= 2) - (a.images.length >= 2));
    const made = [];
    for (const row of ordered) {
      if (made.length >= args.perModel) break;
      const images = [...row.images].sort();
      const base = { kind: "synthetic_screenshot", expected_product_ids: [String(row.product_id)], expected_color: row.color, source_indexed: true };
      const idA = `syn-${key}-${row.product_id}-a`;
      made.push({ id: idA, ...base, slice: "exact_image", source: images[0], augment: { seed: seedFor(idA) }, note: `${row.name} / ${row.color}` });
      if (made.length < args.perModel && images.length >= 2) {
        const idB = `syn-${key}-${row.product_id}-b`;
        made.push({ id: idB, ...base, slice: "different_image", source: images[1], augment: { seed: seedFor(idB) }, note: `${row.name} / ${row.color} — second photo` });
      }
    }
    console.log(`[synthetic] ${key}: ${stocked.length} stocked product-colours → ${made.length} case(s)`);
    cases.push(...made);
  }

  if (args.dump) {
    fs.mkdirSync(args.dump, { recursive: true });
    for (const entry of cases) {
      const local = await readLocalUploadImage(new URL(entry.source, "https://local.invalid").href);
      const buffer = local?.buffer || Buffer.from(await (await fetch(entry.source)).arrayBuffer());
      fs.writeFileSync(path.join(args.dump, `${entry.id}.src.jpg`), buffer);
      fs.writeFileSync(path.join(args.dump, `${entry.id}.jpg`), (await screenshotLike(buffer, entry.augment)).buffer);
    }
  }

  manifest.tenant_id = manifest.tenant_id || tenantId;
  manifest.cases = [...(manifest.cases || []).filter((entry) => entry.kind !== "synthetic_screenshot"), ...cases];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[synthetic] ${cases.length} synthetic case(s) from ${modelsUsed} model(s) → ${manifestPath}`);
  await db.end?.();
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error("[synthetic] failed", error);
    process.exit(1);
  }
);
