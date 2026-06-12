import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureLocalProductImageVariants } from "../services/productImageVariantService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const candidateRoots = [
  path.resolve(repoRoot, "uploads", "products"),
  path.resolve(repoRoot, "server", "uploads", "products"),
  path.resolve(repoRoot, "..", "uploads", "products"),
];
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const parseArgs = () => {
  const limitIndex = process.argv.findIndex((arg) => arg === "--limit");
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity;
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity,
  };
};

const walkFiles = async (root, files = []) => {
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === "variants") continue;
      await walkFiles(fullPath, files);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!supportedExtensions.has(ext)) continue;
    files.push(fullPath);
  }

  return files;
};

const uniqueFiles = async () => {
  const files = [];
  for (const root of candidateRoots) {
    files.push(...(await walkFiles(root)));
  }
  return [...new Set(files)];
};

const main = async () => {
  const { limit } = parseArgs();
  const files = (await uniqueFiles()).slice(0, limit);
  const summary = {
    scanned: 0,
    generated: 0,
    skipped: 0,
  };

  console.log("[product-image-variants:backfill]", {
    roots: candidateRoots,
    limit: Number.isFinite(limit) ? limit : "all",
    files: files.length,
  });

  for (const filePath of files) {
    summary.scanned += 1;
    try {
      const result = await ensureLocalProductImageVariants(filePath);
      summary.generated += result.generated.length;
      summary.skipped += result.skipped.length;
      console.log("[product-image-variants:item]", {
        source: filePath,
        generated: result.generated.map((item) => item.outputPath),
        skipped: result.skipped,
      });
    } catch (error) {
      summary.skipped += 1;
      console.warn("[product-image-variants:item-skip]", {
        source: filePath,
        message: error?.message || String(error),
      });
    }
  }

  console.log("[product-image-variants:summary]", summary);
};

main().catch((error) => {
  console.error("[product-image-variants:backfill-failed]", {
    message: error?.message || String(error),
    stack: error?.stack,
  });
  process.exitCode = 1;
});

