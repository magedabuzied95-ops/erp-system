import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "../database/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, "../../SQL/20260712_product_color_article_codes.sql");

try {
  await db.query(await fs.readFile(migrationPath, "utf8"));
  const result = await db.query(`
    SELECT to_regclass('public.product_color_groups') AS table_name,
           COUNT(*)::int AS rows
    FROM product_color_groups
  `);
  console.log("[product-color-article-migration] complete", result.rows[0]);
} finally {
  await db.end();
}

