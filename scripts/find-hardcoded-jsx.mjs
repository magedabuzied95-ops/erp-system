import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "src");
const outputPath = path.resolve(process.cwd(), "docs/localization-debt-report.md");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const skipDirs = new Set(["node_modules", "dist", "build", ".git"]);
const allowed = new Set(["A4", "SKU", "POS", "P&L", "EGP", "QR", "ID", "URL", "API", "CSV", "PDF"]);
const moduleRules = [
  ["storefront", `${path.sep}storefront${path.sep}`],
  ["pos", `${path.sep}modules${path.sep}pos${path.sep}`],
  ["orders", `${path.sep}modules${path.sep}orders${path.sep}`],
  ["products", `${path.sep}modules${path.sep}products${path.sep}`],
  ["purchases", `${path.sep}modules${path.sep}purchases${path.sep}`],
  ["inventory", `${path.sep}modules${path.sep}inventory${path.sep}`],
  ["accounting", `${path.sep}modules${path.sep}accounting${path.sep}`],
  ["marketing", `${path.sep}modules${path.sep}marketing${path.sep}`],
  ["shared", `${path.sep}shared${path.sep}`],
];

const hasLetters = (value) => /[A-Za-z\u0600-\u06FF]/.test(value);
const isProbablyClassName = (value) => /^(flex|grid|block|inline|hidden|absolute|relative|mt-|mb-|ms-|me-|px-|py-|text-|bg-|border|rounded|shadow|hover:|focus:|disabled:)/.test(value);
const isProbablyUrl = (value) => /^(https?:|\/|#|data:|mailto:|tel:)/.test(value);
const isTranslationCall = (text, index) => {
  const prefix = text.slice(Math.max(0, index - 24), index);
  return /(t|i18n\.t|posLabel|sfText|receiptPrintLabel|invoicePrintLabel)\($/.test(prefix.trim());
};

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, output);
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      output.push(full);
    }
  }
  return output;
}

function moduleFor(file) {
  const normalized = file.split(path.sep).join(path.sep);
  const match = moduleRules.find(([, marker]) => normalized.includes(marker));
  if (match) return match[0];
  if (normalized.includes(`${path.sep}pages${path.sep}`)) return "pages";
  return "other";
}

function shouldKeep(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 3 || clean.length > 140) return false;
  if (allowed.has(clean)) return false;
  if (!hasLetters(clean)) return false;
  if (isProbablyClassName(clean) || isProbablyUrl(clean)) return false;
  if (/^[A-Z0-9_./:-]+$/.test(clean) && clean.length < 16) return false;
  if (/^\{.*\}$/.test(clean)) return false;
  return true;
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function collectHits(file) {
  const text = fs.readFileSync(file, "utf8");
  const hits = [];
  const patterns = [
    { type: "jsx-text", regex: />([^<>{}\n]*[A-Za-z\u0600-\u06FF][^<>{}\n]*)</g },
    { type: "placeholder", regex: /placeholder=(?:"([^"]+)"|'([^']+)')/g },
    { type: "title", regex: /title=(?:"([^"]+)"|'([^']+)')/g },
    { type: "aria-label", regex: /aria-label=(?:"([^"]+)"|'([^']+)')/g },
    { type: "toast", regex: /toast\.(?:success|error|loading)\(\s*(?:"([^"]+)"|'([^']+)')/g },
    { type: "confirm", regex: /(?:confirm|prompt|alert)\(\s*(?:"([^"]+)"|'([^']+)')/g },
    { type: "prop-label", regex: /\b(?:label|checkoutLabel|empty|fallback)=\s*(?:"([^"]+)"|'([^']+)')/g },
  ];

  for (const { type, regex } of patterns) {
    for (const match of text.matchAll(regex)) {
      const value = match[1] || match[2] || "";
      if (!shouldKeep(value)) continue;
      if (type !== "jsx-text" && isTranslationCall(text, match.index || 0)) continue;
      hits.push({
        type,
        line: lineNumber(text, match.index || 0),
        value: value.replace(/\s+/g, " ").trim(),
      });
    }
  }

  return hits;
}

const grouped = new Map();
for (const file of walk(root)) {
  const hits = collectHits(file);
  if (!hits.length) continue;
  const moduleName = moduleFor(file);
  if (!grouped.has(moduleName)) grouped.set(moduleName, []);
  grouped.get(moduleName).push({
    file: path.relative(process.cwd(), file),
    hits: hits.slice(0, 40),
    total: hits.length,
  });
}

const lines = [
  "# Localization Debt Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "This report flags obvious hardcoded UI strings. It is intentionally conservative and may include false positives.",
  "",
];

for (const [moduleName, files] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const count = files.reduce((sum, item) => sum + item.total, 0);
  lines.push(`## ${moduleName} (${count})`, "");
  for (const item of files) {
    lines.push(`### ${item.file}`);
    for (const hit of item.hits) {
      lines.push(`- ${hit.line} [${hit.type}] ${hit.value}`);
    }
    if (item.total > item.hits.length) {
      lines.push(`- ... ${item.total - item.hits.length} more`);
    }
    lines.push("");
  }
}

if (!grouped.size) {
  lines.push("No obvious hardcoded UI strings found.", "");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Localization debt report written to ${path.relative(process.cwd(), outputPath)}`);
for (const [moduleName, files] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const count = files.reduce((sum, item) => sum + item.total, 0);
  console.log(`${moduleName}: ${count}`);
}
