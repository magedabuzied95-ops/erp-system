// The Reporting Center export engine.
//
// Two failures this guards against, both of which shipped in the legacy exporter and
// went unnoticed for a long time: an Arabic PDF that renders as empty boxes, and an
// export that carries a column the page deliberately hid.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";

import { EXPORT_FORMATS, buildCsv, formatCell, hasArabic } from "../../src/modules/reports/lib/reportExport.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const ENGINE = "../../src/modules/reports/lib/reportExport.js";

const sheet = (rows, columns) => ({ name: "Suppliers", columns, rows });

/* ---------------------------------------------------------------- cell rules */

test("a value that could not be computed is an em dash, never a zero", () => {
  for (const missing of [null, undefined, ""]) {
    assert.equal(formatCell(missing, { kind: "currency" }, "en"), "—");
    assert.equal(formatCell(missing, { kind: "percent" }, "en"), "—");
    assert.equal(formatCell(missing, {}, "en"), "—");
  }
  // A verified zero is still a zero. Collapsing the two would destroy the distinction
  // permanently, because a spreadsheet keeps no record of which was which.
  assert.equal(formatCell(0, {}, "en"), "0");
  assert.notEqual(formatCell(0, {}, "en"), formatCell(null, {}, "en"));
});

test("each column kind formats the way the screen formats it", () => {
  assert.match(formatCell(0.1234, { kind: "percent" }, "en"), /12\.3%/);
  assert.equal(formatCell(3.14159, { kind: "decimal" }, "en"), "3.14");
  assert.equal(formatCell(1234, {}, "en"), "1,234");
  assert.match(formatCell(1500, { kind: "currency" }, "en"), /1,500/);
  // A non-numeric cell passes through untouched.
  assert.equal(formatCell("Adidas", {}, "en"), "Adidas");
});

test("Arabic detection covers the whole Arabic block", () => {
  assert.equal(hasArabic("قيمة المشتريات"), true);
  assert.equal(hasArabic("Purchase spend"), false);
  assert.equal(hasArabic("Nike حذاء"), true, "a mixed string is Arabic for shaping purposes");
  assert.equal(hasArabic(""), false);
  assert.equal(hasArabic(null), false);
});

/* ----------------------------------------------------------------------- CSV */

const COLUMNS = [
  { key: "supplierName", label: "المورد" },
  { key: "spend", label: "الإنفاق", kind: "currency", align: "end" },
  { key: "units", label: "الوحدات", align: "end" },
];

test("CSV opens with a UTF-8 BOM, or Excel on Windows mangles every Arabic column", () => {
  const csv = buildCsv({
    sheets: [sheet([{ supplierName: "مورد أ", spend: 1000, units: 12 }], COLUMNS)],
    language: "ar",
    title: "المشتريات",
  });
  assert.equal(csv.charCodeAt(0), 0xfeff, "the first character must be the byte-order mark");
  assert.ok(csv.includes("مورد أ"));
});

test("CSV escapes quotes and separators rather than corrupting the row", () => {
  const csv = buildCsv({
    sheets: [sheet([{ supplierName: 'Ali "The Boss", Cairo', spend: 10, units: 1 }], COLUMNS)],
    language: "en",
  });
  assert.ok(csv.includes('"Ali ""The Boss"", Cairo"'), "an embedded quote must be doubled and the cell quoted");
  // Every cell is quoted, so a comma inside a supplier name can never split a row.
  const dataLine = csv.split("\r\n").find((line) => line.includes("The Boss"));
  assert.equal(dataLine.split('","').length, COLUMNS.length);
});

test("CSV carries the title and the period, so a file is readable a week later", () => {
  const csv = buildCsv({
    sheets: [sheet([{ supplierName: "A", spend: 1, units: 1 }], COLUMNS)],
    language: "en",
    title: "Purchasing",
    filterSummary: "Period 2026-01-01 to 2026-01-31",
  });
  assert.ok(csv.includes("Purchasing"));
  assert.ok(csv.includes("2026-01-01"));
});

test("a hidden column is absent from the file, not blank in it", () => {
  const restricted = [...COLUMNS.slice(0, 1), { ...COLUMNS[1], visible: false }, COLUMNS[2]];
  const csv = buildCsv({
    sheets: [sheet([{ supplierName: "A", spend: 99999, units: 3 }], restricted)],
    language: "en",
  });
  assert.ok(!csv.includes("99999"), "a restricted value must not reach the file");
  assert.ok(!csv.includes("الإنفاق"), "and neither must its header");
  assert.ok(csv.includes("الوحدات"), "the visible columns are unaffected");
});

test("every declared format is one the engine actually implements", async () => {
  assert.deepEqual(EXPORT_FORMATS, ["pdf", "xlsx", "csv", "print"]);
  const source = await read(ENGINE);
  for (const format of EXPORT_FORMATS) {
    assert.ok(source.includes(`format === "${format}"`) || format === "print", `${format} has no branch`);
  }
  assert.match(source, /if \(!EXPORT_FORMATS\.includes\(format\)\) throw new Error/);
  // An empty export throws rather than handing over a file with nothing in it.
  assert.match(source, /throw new Error\("NOTHING_TO_EXPORT"\)/);
});

/* ---------------------------------------------------------------- Arabic PDF */

test("the Arabic font asset the PDF depends on exists in the repository", async () => {
  const font = new URL("../../server/assets/fonts/NotoSansArabic.ttf", import.meta.url);
  await access(font);
});

test("the PDF embeds an Arabic face and never falls back to a Latin-only one", async () => {
  const source = await read(ENGINE);

  // jsPDF's built-in faces carry no Arabic glyphs. This is exactly why every legacy PDF
  // rendered Arabic as empty boxes.
  assert.match(source, /NotoSansArabic\.ttf/);
  assert.match(source, /doc\.addFileToVFS\(ARABIC_FONT\.fileName, fontData\)/);
  assert.match(source, /doc\.addFont\(ARABIC_FONT\.fileName, ARABIC_FONT\.family, "normal"\)/);
  assert.match(source, /doc\.addFont\(ARABIC_FONT\.fileName, ARABIC_FONT\.family, "bold"\)/);
  assert.ok(!/setFont\("helvetica"/.test(source), "helvetica cannot render a single Arabic character");
  assert.ok(!/"times"|"courier"/.test(source), "no Latin-only built-in face may be selected");

  // Every text call in the document goes through the embedded family.
  assert.match(source, /styles: \{ font: ARABIC_FONT\.family/);
  assert.match(source, /headStyles: \{ font: ARABIC_FONT\.family/);
});

test("Arabic strings are shaped once, and setR2L stays off", async () => {
  const source = await read(ENGINE);

  // processArabic performs BOTH the contextual shaping and the visual reordering.
  // Turning setR2L on afterwards reverses an already-reordered string and produces
  // mirrored gibberish — the detail that cost real debugging in the label printer.
  assert.match(source, /doc\.processArabic\(raw\)/);
  assert.match(source, /doc\.setR2L\(false\)/);
  assert.ok(!/setR2L\(true\)/.test(source), "R2L must never be enabled after processArabic");

  // Shaping is applied to headers, cells, the title and the footer, not just the body.
  assert.match(source, /head: \[columns\.map\(\(column\) => shape\(column\.label\)\)\]/);
  assert.match(source, /body: sheet\.rows\.map\(\(row\) => columns\.map\(\(column\) => shape\(formatCell/);
  assert.match(source, /doc\.text\(shape\(title \|\| ""\)/);
});

test("an Arabic PDF table reads right to left", async () => {
  const source = await read(ENGINE);
  // autoTable has no RTL mode; reversing the column order and right-aligning is what an
  // RTL table actually needs.
  assert.match(source, /const columns = rtl \? \[\.\.\.visible\]\.reverse\(\) : visible/);
  assert.match(source, /const align = rtl \? "right" : "left"/);
  assert.match(source, /const rtl = String\(language \|\| ""\)\.toLowerCase\(\)\.startsWith\("ar"\)/);
});

test("a long PDF repeats its header and dates every page", async () => {
  const source = await read(ENGINE);
  assert.match(source, /showHead: "everyPage"/, "page four must not be an unlabelled block of digits");
  assert.match(source, /doc\.text\(`\$\{page\} \/ \$\{pages\}`/);
  assert.match(source, /doc\.text\(shape\(stamp\(\)\)/);
  assert.match(source, /doc\.text\(shape\(brand \|\| ""\)/);
});

/* -------------------------------------------------------------- Excel, print */

test("Excel keeps numbers numeric so a column can be summed", async () => {
  const source = await read(ENGINE);
  assert.match(source, /if \(typeof value === "number" && Number\.isFinite\(value\)\) return value/);
  assert.match(source, /worksheet\["!cols"\]/, "columns are sized, or Arabic headers clip to ###");
  assert.match(source, /worksheet\["!freeze"\]/, "the header row is frozen for long exports");
  // Excel rejects several characters in a sheet name and caps the length at 31; an
  // untreated Arabic section title would otherwise fail the whole workbook write.
  assert.match(source, /const sheetName = /);
  assert.match(source, /\.slice\(0, 31\)/);
  assert.match(source, /XLSX\.utils\.book_append_sheet\(workbook, worksheet, sheetName\(sheet\.name, index\)\)/);
});

test("the print document repeats its header and is direction-aware", async () => {
  const source = await read(ENGINE);
  assert.match(source, /thead \{ display: table-header-group; \}/, "a long printed table must repeat its header");
  assert.match(source, /dir="\$\{rtl \? "rtl" : "ltr"\}"/);
  assert.match(source, /lang="\$\{rtl \? "ar" : "en"\}"/);
  assert.match(source, /escapeHtml/, "print content must be escaped, it comes from customer and supplier names");
  // A blocked pop-up is reported rather than silently producing nothing.
  assert.match(source, /PRINT_WINDOW_BLOCKED/);
});

test("the brand is read, never invented", async () => {
  const menu = await read("../../src/modules/reports/components/ReportExportMenu.jsx");
  assert.match(menu, /general\.company_name/);
  assert.match(menu, /storefront\.store_name/);
  // A hardcoded shop name on another tenant's financial document would be a fabricated
  // brand, which is worse than no brand at all.
  assert.ok(!/"M1 Store"|'M1 Store'/.test(menu), "no hardcoded shop name");
  assert.match(menu, /\.catch\(\(\) => ""\)/, "an unreadable brand is empty, not a guess");
});

/* --------------------------------------------------- page-level permission gating */

test("every reporting page can export, and none of them re-fetches to do it", async () => {
  const pages = [
    "ExecutiveOverview",
    "SalesIntelligence",
    "InventoryIntelligence",
    "PurchasingIntelligence",
    "CustomerIntelligence",
    "CouponsPerformance",
  ];
  for (const page of pages) {
    const source = await read(`../../src/modules/reports/pages/${page}.jsx`);
    assert.match(source, /<ReportExportMenu/, `${page} has no export control`);
    // The rows come from what the page already holds. A second request here is how a
    // file and the screen it came from start disagreeing.
    assert.ok(
      /sheets=\{\(\) =>/.test(source) || /sheets=\{buildExportSheets/.test(source),
      `${page} must pass a thunk over the rows it already rendered`
    );
  }
});

test("a cost or profit column is omitted from the export when the caller may not see it", async () => {
  const sales = await read("../../src/modules/reports/pages/SalesIntelligence.jsx");
  assert.match(sales, /\.\.\.\(showProfit\s*\n?\s*\?\s*\[/, "sales profit columns must be conditional");
  assert.ok(!/key: "grossProfit"[^}]*visible/.test(sales), "profit is omitted, not marked invisible-but-present");

  const purchasing = await read("../../src/modules/reports/pages/PurchasingIntelligence.jsx");
  assert.match(purchasing, /\.\.\.\(showCost \? \[\{ key: "spend"/, "purchasing spend must be conditional");

  const customers = await read("../../src/modules/reports/pages/CustomerIntelligence.jsx");
  // The identity column follows the same rule as the screen: a name only when the account
  // may see one. An export must not be a way around a permission the page enforces.
  assert.match(customers, /key: showNames \? "customerName" : "rank"/);
});
