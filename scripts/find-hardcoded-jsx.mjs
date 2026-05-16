import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "src");
const skip = new Set(["n/a", "SKU", "P&L", "A4", "POS"]);

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, output);
    } else if (/\.(jsx|js|tsx|ts)$/.test(entry.name)) {
      output.push(full);
    }
  }
  return output;
}

const files = walk(root);
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const hits = new Set();
  const patterns = [
    />([^<>{}]*[A-Za-z][^<>{}]*)</g,
    /placeholder="([^"]*[A-Za-z][^"]*)"/g,
    /title="([^"]*[A-Za-z][^"]*)"/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = String(match[1] || "").trim();
      if (!value || skip.has(value)) continue;
      if (/^[A-Za-z0-9 _\-/.&,():%]+$/.test(value)) hits.add(value);
    }
  }

  if (hits.size > 0) {
    console.log(`\n${path.relative(process.cwd(), file)}`);
    for (const value of Array.from(hits).slice(0, 20)) {
      console.log(`  - ${value}`);
    }
  }
}
