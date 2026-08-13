/**
 * NON-RESERVED safely-fixable localization debt.
 *
 * `scripts/i18n-bidirectional.mjs` answers "how much broken chrome is there".
 * It does NOT answer "how much of it am I allowed to fix", and those are very
 * different numbers: the AI Inbox is under a hard freeze, the Product Form is
 * visually frozen, and print/export output has its own track. Reporting only
 * the raw total makes closure look unreachable and hides the fact that the
 * reachable part is small.
 *
 * This splits the two broken buckets into RESERVED (correctly classified, but
 * out of scope for the localization producer) and NON-RESERVED (the actual
 * closure target), so "remaining" is never an unexplained number.
 *
 * Every reserved entry carries the reason it is reserved AND, where the file is
 * not itself an obvious owner, the import chain that proves it.
 */
import fs from "node:fs";
import path from "node:path";

import { classify } from "./i18n-classify.mjs";
import { scanEnglish } from "./i18n-english-scan.mjs";

/**
 * Bucket E, decided PER HIT — a RENDERED receipt component.
 *
 * The English scanner's print detector only recognises a generated print
 * DOCUMENT (`printWindow.document.write(`<html>...`)`). A thermal receipt built
 * as a React component is the same artwork reached a different way, and it is
 * named in the print/thermal firewall: `ReceiptPreview` and
 * `ThermalReceiptFinal` both live inside pos/components/CartSidebar.jsx, whose
 * 28 Arabic literals are entirely receipt copy — "فاتورة بيع", "شكرًا لزيارتكم",
 * the returns policy — and none of it is cart chrome.
 *
 * Reserving the FILE would be wrong: CartSidebar is 3126 lines and the cart UI
 * around the receipt is ordinary chrome that must stay measurable. So the rule
 * is scoped to the component body, which is what the print track owns.
 */
const RECEIPT_COMPONENT = /^\s*(?:export\s+)?(?:function|const)\s+(\w*(?:Receipt|Thermal)\w*)\s*[({=]/;

export const receiptArtworkRanges = (text) => {
  const lines = text.split(/\r?\n/);
  const ranges = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = RECEIPT_COMPONENT.exec(lines[i]);
    // Only a TOP-LEVEL component owns a whole block; a nested helper does not.
    if (!open || /^\s/.test(lines[i])) continue;
    /*
     * The terminator must be a line that IS the closing brace. Matching any
     * line that merely STARTS with `}` stops at the `}) {` that ends a
     * destructured parameter list spread over several lines, which truncated
     * ThermalReceiptFinal to its signature and left its 27 receipt literals
     * counted as chrome.
     */
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\}\s*;?\s*$/.test(lines[j])) { end = j + 1; break; }
    }
    ranges.push([i + 1, end, open[1]]);
  }
  return ranges;
};

const artworkCache = new Map();
const isReceiptArtwork = (file, line) => {
  if (!artworkCache.has(file)) {
    const full = path.resolve(file);
    artworkCache.set(file, fs.existsSync(full) ? receiptArtworkRanges(fs.readFileSync(full, "utf8")) : []);
  }
  return artworkCache.get(file).some(([from, to]) => line >= from && line <= to);
};

/**
 * Bucket H — AI Inbox reserved.
 *
 * Direct Inbox surfaces plus the components proven (by import) to render inside
 * AiInbox.jsx / AiInboxPwa.jsx. Localizing these is a separate, dedicated task:
 * the Inbox mixes chrome with customer messages and model output on the same
 * screen, so a careless t() there rewrites a conversation rather than a label.
 */
export const AI_INBOX_RESERVED = new Map([
  ["src/modules/aiSupport/pages/AiInbox.jsx", "AI Inbox page."],
  ["src/modules/aiSupport/pages/AiInboxPwa.jsx", "AI Inbox PWA page."],
  ["src/modules/aiSupport/components/TranscriptMessage.jsx", "Renders Inbox conversation turns."],
  ["src/modules/aiSupport/components/ProductCardPicker.jsx", "Inbox product picker (Phase 13.4 multi-select)."],
  ["src/modules/aiSupport/components/ProductCardMessage.jsx", "Inbox outbound product card."],
  ["src/modules/aiSupport/components/PwaOrderComposer.jsx", "Inbox PWA order composer."],
  ["src/modules/aiSupport/components/AppleEmojiPicker.jsx", "Inbox composer emoji picker."],
  ["src/components/ai/AILiveLogs.jsx", "Imported by AiInbox.jsx."],
]);

/**
 * Bucket I — Inbox-sensitive shared.
 *
 * Rendered by the Inbox AND by at least one non-Inbox surface, or feeding the
 * Inbox's CRM/intelligence output. Touching them changes the Inbox, so they
 * move with the Inbox, not with their other consumer.
 */
export const INBOX_SENSITIVE = new Map([
  ["src/modules/aiSupport/components/SocialCommentsWorkspace.jsx", "AiInbox + AiInboxPwa + marketing/SocialCommentsCenter."],
  ["src/modules/aiSupport/components/SocialCommentsPanel.jsx", "AiInboxPwa."],
  ["src/modules/aiSupport/components/socialCommentTimeline.jsx", "Social comments surface shared with the Inbox."],
  ["src/modules/aiSupport/components/Customer360Drawer.jsx", "AiInbox + AiInboxPwa + AiLeadCenter + SocialCommentsCenter."],
  ["src/modules/aiSupport/components/AIInboxAnalysisPanel.jsx", "AiInboxPwa."],
  ["src/modules/aiSupport/utils/crm/crmIntelligence.ts", "CRM output consumed by useAIInboxAnalysis."],
  ["src/modules/aiSupport/intelligence/recommendAction.ts", "ConversationIntelligence output rendered in the Inbox."],
  ["src/modules/aiSupport/intelligence/recommendReply.ts", "ConversationIntelligence output rendered in the Inbox."],
  ["src/modules/aiSupport/copilot/SuggestionEngine.ts", "Inbox copilot suggestions."],
  ["src/modules/aiSupport/decision/strategies/AutomationStrategy.ts", "Inbox decision layer."],
]);

/** Everything under the social-automation drawer tree reaches the Inbox via SocialCommentsWorkspace. */
const INBOX_SENSITIVE_PREFIX = "src/modules/aiSupport/components/socialAutomation/";

/**
 * Bucket J — Product Form / ProductEdit hold.
 *
 * Visually frozen for a separate post-closure visual program. Reported, never
 * silently excluded; migrating any of it needs its own checkpoint.
 */
export const PRODUCT_FORM_HOLD = new Map([
  ["src/modules/products/components/ProductForm.jsx", "Product Form freeze."],
  ["src/modules/products/pages/CreateProduct.jsx", "Product Form freeze."],
  ["src/modules/products/pages/ProductEdit.jsx", "Product Form freeze."],
  ["src/modules/products/components/CrocsSizeSelector.jsx", "Rendered only by CreateProduct + ProductEdit."],
  ["src/modules/products/components/MultiVersionGenerator.jsx", "Product Form variant generator."],
  ["src/modules/products/components/ArticleCodeMultiInput.jsx", "Product Form article-code input."],
  ["src/modules/products/lib/requiredProductFields.js", "Product Form required-field vocabulary."],
]);

/**
 * Bucket E — print/export/thermal/barcode artwork.
 *
 * The scanner already buckets the files it recognises by name; these are the
 * ones whose print role is structural rather than nominal.
 */
export const PRINT_RESERVED = new Map([
  ["src/modules/products/pages/BarcodeLabels.jsx", "Barcode label artwork."],
  ["src/modules/products/lib/barcodePdfGenerator.js", "Generated barcode PDF copy."],
]);

/**
 * Bucket K — explicit product decisions recorded on `main`. Not defects; they
 * are deliberate and must not be reversed by a localization pass.
 */
export const PRODUCT_DECISION = new Map([
  ["src/modules/employees/pages/EmployeePayrollPortal.jsx", "Payroll portal language deliberately pinned."],
]);

const RESERVED = [
  ["H. AI Inbox reserved", AI_INBOX_RESERVED],
  ["I. Inbox-sensitive shared", INBOX_SENSITIVE],
  ["J. Product Form hold", PRODUCT_FORM_HOLD],
  ["E. print/export artwork", PRINT_RESERVED],
  ["K. product-decision debt", PRODUCT_DECISION],
];

export const reservedBucket = (file) => {
  if (file.startsWith(INBOX_SENSITIVE_PREFIX)) return "I. Inbox-sensitive shared";
  for (const [name, map] of RESERVED) if (map.has(file)) return name;
  return null;
};

export function partition() {
  const ar = classify();
  const en = scanEnglish();
  const rows = new Map();
  const artwork = new Map();
  const add = (file, key, hits) => {
    /*
     * Receipt artwork is split off PER HIT and attributed to the print track,
     * so a file that holds both a receipt and real chrome keeps the chrome
     * measurable instead of vanishing behind a file-level exclusion.
     */
    const printed = hits.filter((hit) => isReceiptArtwork(file, hit.line)).length;
    if (printed) artwork.set(file, (artwork.get(file) || 0) + printed);
    const count = hits.length - printed;
    if (!count) return;
    if (!rows.has(file)) rows.set(file, { file, ar: 0, en: 0, bucket: reservedBucket(file) });
    rows.get(file)[key] += count;
  };
  for (const row of ar.broken) add(row.file, "ar", row.hits.filter((hit) => hit.script === "ar"));
  for (const row of en.brokenEnglish) add(row.file, "en", row.hits);
  const list = [...rows.values()].sort((a, b) => b.ar + b.en - (a.ar + a.en));
  list.artwork = artwork;
  return list;
}

if (process.argv[1]?.endsWith("i18n-nonreserved.mjs")) {
  const all = partition();
  const open = all.filter((r) => !r.bucket);
  const held = all.filter((r) => r.bucket);

  const total = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);

  console.log("NON-RESERVED SAFELY-FIXABLE (the closure target)\n");
  console.log("  ar    en  file");
  for (const row of open) {
    console.log(`${String(row.ar).padStart(4)}  ${String(row.en).padStart(4)}  ${row.file}`);
  }
  console.log(
    `\n  NON-RESERVED AR->EN ${total(open, "ar")}   NON-RESERVED EN->AR ${total(open, "en")}   (${open.length} files)`
  );

  console.log("\n\nRESERVED / HELD (correctly classified, out of scope)\n");
  for (const [name] of RESERVED) {
    const rows = held.filter((row) => row.bucket === name);
    if (!rows.length) continue;
    console.log(`${name}  —  AR ${total(rows, "ar")}  EN ${total(rows, "en")}  (${rows.length} files)`);
    for (const row of rows) console.log(`    ${String(row.ar).padStart(4)}  ${String(row.en).padStart(4)}  ${row.file}`);
  }
  if (all.artwork.size) {
    console.log("\nE. rendered receipt artwork (split off per hit, owned by the print track)");
    for (const [file, count] of all.artwork) console.log(`    ${String(count).padStart(4)}        ${file}`);
  }
  const artworkTotal = [...all.artwork.values()].reduce((sum, count) => sum + count, 0);
  console.log(`\n  RESERVED AR->EN ${total(held, "ar")}   RESERVED EN->AR ${total(held, "en")}`);
  console.log(
    `  GRAND TOTAL ${total(all, "ar") + total(all, "en") + artworkTotal}` +
      ` = non-reserved ${total(open, "ar") + total(open, "en")}` +
      ` + reserved ${total(held, "ar") + total(held, "en")}` +
      ` + receipt artwork ${artworkTotal}`
  );
}
