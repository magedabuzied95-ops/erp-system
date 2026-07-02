import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const exportPath = path.join(repoRoot, "server", "reports", "ai-data-remediation-export.csv");
const duplicateSlugsPath = path.join(repoRoot, "server", "reports", "ai-data-remediation-duplicate-slugs.csv");
const pricesPath = path.join(repoRoot, "server", "reports", "ai-data-remediation-prices.csv");
const stockPath = path.join(repoRoot, "server", "reports", "ai-data-remediation-stock.csv");

const splitLines = (text = "") => String(text || "").replace(/\r\n/g, "\n").split("\n");

const parseCsv = (input = "") => {
  const text = String(input || "");
  if (!text.trim()) return [];

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((current) => current.length && current.some((value) => String(value ?? "").trim() !== ""));
};

const toCsv = (rows = []) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
};

const rowToObject = (headers = [], values = []) =>
  headers.reduce((acc, header, index) => {
    acc[header] = values[index] ?? "";
    return acc;
  }, {});

const text = (value = "") => String(value ?? "").trim();

const loadRows = async () => {
  const parsed = parseCsv(await fs.readFile(exportPath, "utf8"));
  if (!parsed.length) return [];
  const [headers, ...records] = parsed;
  return records.map((values) => rowToObject(headers, values));
};

const isDuplicateSlug = (row) => text(row.issue_type).toLowerCase() === "duplicate slugs";
const isPriceIssue = (row) => {
  const issue = text(row.issue_type).toLowerCase();
  return issue === "missing price source" || issue === "zero selling price";
};
const isStockIssue = (row) => {
  const issue = text(row.issue_type).toLowerCase();
  return issue === "available with zero stock" || issue === "stock inconsistencies";
};

const writeCsv = async (filePath, rows) => {
  await fs.writeFile(filePath, toCsv(rows), "utf8");
};

const summarize = (rows, label) => {
  const counts = rows.reduce((acc, row) => {
    const key = `${text(row.severity) || "unknown"} / ${text(row.issue_type) || "unknown"}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`\n${label}`);
  if (!sorted.length) {
    console.log("  none");
    return;
  }
  for (const [key, count] of sorted) {
    console.log(`  ${key}: ${count}`);
  }
};

const run = async () => {
  const rows = await loadRows();
  const duplicateSlugRows = rows.filter(isDuplicateSlug);
  const priceRows = rows.filter(isPriceIssue);
  const stockRows = rows.filter(isStockIssue);

  await writeCsv(duplicateSlugsPath, duplicateSlugRows);
  await writeCsv(pricesPath, priceRows);
  await writeCsv(stockPath, stockRows);

  console.log(JSON.stringify({
    source: exportPath,
    outputs: {
      duplicate_slugs: { path: duplicateSlugsPath, rows: duplicateSlugRows.length },
      prices: { path: pricesPath, rows: priceRows.length },
      stock: { path: stockPath, rows: stockRows.length },
    },
    groups: {
      duplicate_slug: duplicateSlugRows.length,
      missing_price_source_or_zero_price: priceRows.length,
      available_with_zero_stock_or_stock_inconsistency: stockRows.length,
    },
  }, null, 2));

  summarize(duplicateSlugRows, "Duplicate slugs");
  summarize(priceRows, "Prices");
  summarize(stockRows, "Stock");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
