import { formatMoney, formatPercentValue } from "./metricFormat.js";
import { formatNumber } from "../../../shared/lib/currency.js";

/**
 * The Reporting Center export engine.
 *
 * ONE implementation for every report, in four formats. The Reporting Center previously
 * had no exports at all, and the legacy /reports page had four one-off implementations
 * whose PDF could not render a single Arabic character. Both of those are the reason this
 * is a shared module rather than a helper on one page.
 *
 * WHAT AN EXPORT IS ALLOWED TO CONTAIN
 *
 * Exactly what is on screen. The caller passes the rows it already rendered, so a file
 * can never disagree with the page it was exported from — no second request, no different
 * filters, no different permission resolution. In particular a column the caller hid
 * because the user lacks reports:cost is simply not in the column list, so it cannot leak
 * into a spreadsheet that then gets emailed.
 *
 * ARABIC PDF
 *
 * jsPDF's built-in faces carry no Arabic glyphs and no shaping, which is why every legacy
 * PDF rendered Arabic as empty boxes. The fix is the one already proven by the product
 * label printer: embed server/assets/fonts/NotoSansArabic.ttf into the document's virtual
 * file system, then run each Arabic string through doc.processArabic() — which performs
 * the contextual shaping AND the visual reordering. setR2L must stay FALSE afterwards:
 * turning it on reverses an already-reordered string and produces mirrored gibberish.
 * That detail cost real debugging time in the label printer; it is not re-learnable from
 * the jsPDF documentation.
 *
 * Column ORDER is reversed for Arabic so the table reads right to left, and every cell is
 * right-aligned. autoTable has no RTL mode; this is what an RTL table actually needs.
 */

/* ------------------------------------------------------------------ formatting */

const ARABIC_PATTERN = /[؀-ۿ]/;
export const hasArabic = (value = "") => ARABIC_PATTERN.test(String(value ?? ""));

const ARABIC_FONT = {
  fileName: "reporting-arabic.ttf",
  family: "ReportingArabic",
  url: new URL("../../../../server/assets/fonts/NotoSansArabic.ttf", import.meta.url).href,
};

let arabicFontPromise = null;

const arrayBufferToBinaryString = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked: String.fromCharCode(...bytes) on an 800KB font blows the argument limit.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return binary;
};

const registerArabicFont = async (doc) => {
  if (!arabicFontPromise) {
    arabicFontPromise = fetch(ARABIC_FONT.url)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load the Arabic report font: ${response.status}`);
        return response.arrayBuffer();
      })
      .then(arrayBufferToBinaryString);
  }
  const fontData = await arabicFontPromise;
  doc.addFileToVFS(ARABIC_FONT.fileName, fontData);
  doc.addFont(ARABIC_FONT.fileName, ARABIC_FONT.family, "normal");
  doc.addFont(ARABIC_FONT.fileName, ARABIC_FONT.family, "bold");
  if (typeof doc.setLanguage === "function") doc.setLanguage("ar");
};

/**
 * Turn one cell into the string a human reads.
 *
 * `null` is an em dash, never 0 — the same rule the screen follows. A metric that could
 * not be computed and a metric that is genuinely zero are different facts, and a
 * spreadsheet full of zeros destroys the distinction permanently.
 */
export const formatCell = (value, column, language) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number") return String(value);
  switch (column?.kind) {
    case "currency":
      return formatMoney(value, language) ?? "—";
    case "percent":
      return formatPercentValue(value, language) ?? "—";
    case "decimal":
      return formatNumber(Number(value.toFixed(2)), language);
    case "text":
      return String(value);
    default:
      return formatNumber(value, language);
  }
};

/** Raw value for a spreadsheet cell: numbers stay numbers so Excel can total them. */
const rawCell = (value) => {
  if (value === null || value === undefined || value === "") return "";
  return value;
};

const stamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const safeFileName = (value) =>
  String(value || "report")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);

/**
 * Hand the browser a file.
 *
 * Revoking the object URL on the next task rather than immediately: Safari has not always
 * finished reading the blob by the time the click handler returns, and revoking too early
 * produces a silently empty download.
 */
const download = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/* ------------------------------------------------------------------------ CSV */

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

/**
 * CSV. UTF-8 with a BOM, because Excel on Windows reads a BOM-less UTF-8 file as the
 * system codepage and turns every Arabic column into mojibake.
 */
export const buildCsv = ({ sheets, language, title, filterSummary }) => {
  const lines = [];
  if (title) lines.push(csvEscape(title));
  if (filterSummary) lines.push(csvEscape(filterSummary));
  if (lines.length) lines.push("");

  sheets.forEach((sheet, index) => {
    if (index > 0) lines.push("");
    if (sheet.name) lines.push(csvEscape(sheet.name));
    const columns = sheet.columns.filter((column) => column.visible !== false);
    lines.push(columns.map((column) => csvEscape(column.label)).join(","));
    sheet.rows.forEach((row) => {
      lines.push(columns.map((column) => csvEscape(formatCell(row[column.key], column, language))).join(","));
    });
  });

  return `﻿${lines.join("\r\n")}`;
};

/* ---------------------------------------------------------------------- Excel */

const buildXlsx = async ({ sheets, language, title, filterSummary }) => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet, index) => {
    const columns = sheet.columns.filter((column) => column.visible !== false);
    const header = columns.map((column) => column.label);
    const body = sheet.rows.map((row) =>
      columns.map((column) => {
        const value = row[column.key];
        // Numbers stay numeric so a manager can sum a column in Excel. Only genuinely
        // non-numeric cells are stringified.
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (value === null || value === undefined) return "";
        return typeof value === "string" ? value : rawCell(value);
      })
    );

    const preamble = [];
    if (index === 0) {
      if (title) preamble.push([title]);
      if (filterSummary) preamble.push([filterSummary]);
      if (preamble.length) preamble.push([]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet([...preamble, header, ...body]);

    // Column widths from the longest cell, so Arabic headers are not clipped to ###.
    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const longest = body.reduce(
        (max, row) => Math.max(max, String(row[columnIndex] ?? "").length),
        String(column.label || "").length
      );
      return { wch: Math.min(Math.max(longest + 2, 10), 42) };
    });
    // Freeze the header row so a 600-row export stays readable while scrolling.
    worksheet["!freeze"] = { xSplit: 0, ySplit: preamble.length + 1 };

    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName(sheet.name, index));
  });

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};

/** Excel rejects these characters in a sheet name and caps it at 31 characters. */
const sheetName = (name, index) =>
  String(name || `Sheet ${index + 1}`).replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || `Sheet ${index + 1}`;

/* ------------------------------------------------------------------------ PDF */

const buildPdf = async ({ sheets, language, title, subtitle, filterSummary, brand }) => {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;

  const rtl = String(language || "").toLowerCase().startsWith("ar");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  await registerArabicFont(doc);
  // processArabic has already reordered the glyphs; setR2L would reverse them again.
  if (typeof doc.setR2L === "function") doc.setR2L(false);

  const shape = (value) => {
    const raw = String(value ?? "");
    if (!hasArabic(raw)) return raw;
    return typeof doc.processArabic === "function" ? doc.processArabic(raw) : raw;
  };

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const headEnd = rtl ? pageWidth - margin : margin;
  const align = rtl ? "right" : "left";

  doc.setFont(ARABIC_FONT.family, "bold");
  doc.setFontSize(15);
  doc.text(shape(title || ""), headEnd, 14, { align });

  doc.setFont(ARABIC_FONT.family, "normal");
  doc.setFontSize(9);
  let cursor = 20;
  if (subtitle) {
    doc.setTextColor(90);
    doc.text(shape(subtitle), headEnd, cursor, { align });
    cursor += 5;
  }
  if (filterSummary) {
    doc.setTextColor(120);
    doc.text(shape(filterSummary), headEnd, cursor, { align });
    cursor += 5;
  }
  doc.setTextColor(0);

  let startY = cursor + 2;

  sheets.forEach((sheet, index) => {
    // RTL tables read right to left, and autoTable has no RTL mode of its own.
    const visible = sheet.columns.filter((column) => column.visible !== false);
    const columns = rtl ? [...visible].reverse() : visible;

    if (sheet.name) {
      if (index > 0) startY += 4;
      doc.setFont(ARABIC_FONT.family, "bold");
      doc.setFontSize(11);
      doc.text(shape(sheet.name), headEnd, startY, { align });
      startY += 4;
    }

    autoTable(doc, {
      startY,
      margin: { left: margin, right: margin },
      head: [columns.map((column) => shape(column.label))],
      body: sheet.rows.map((row) => columns.map((column) => shape(formatCell(row[column.key], column, language)))),
      styles: { font: ARABIC_FONT.family, fontStyle: "normal", fontSize: 8, cellPadding: 1.6, halign: align },
      headStyles: { font: ARABIC_FONT.family, fontStyle: "bold", fillColor: [237, 240, 243], textColor: 40, halign: align },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      // A table that runs past the page break repeats its header, so page four is not an
      // unlabelled block of digits.
      showHead: "everyPage",
      theme: "grid",
      tableWidth: "auto",
    });

    startY = (doc.lastAutoTable?.finalY ?? startY) + 6;
  });

  // Footer on every page: who produced it and when, so a printed copy can be dated.
  const pages = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont(ARABIC_FONT.family, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(shape(brand || ""), margin, pageHeight - 6, { align: "left" });
    doc.text(shape(stamp()), pageWidth / 2, pageHeight - 6, { align: "center" });
    doc.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 6, { align: "right" });
  }

  return doc;
};

/* ---------------------------------------------------------------------- print */

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Print view.
 *
 * A separate window rather than a print stylesheet on the app: the reporting pages carry
 * a sidebar, a section navigator, collapsible sections and a chart that measures its own
 * host, and none of those survive a print layout intact. A purpose-built document prints
 * the same numbers with none of the chrome, and inherits the browser's own Arabic shaping
 * for free.
 */
const buildPrintDocument = ({ sheets, language, title, subtitle, filterSummary, brand }) => {
  const rtl = String(language || "").toLowerCase().startsWith("ar");
  const tables = sheets
    .map((sheet) => {
      const columns = sheet.columns.filter((column) => column.visible !== false);
      const head = columns
        .map((column) => `<th class="${column.align === "end" ? "num" : ""}">${escapeHtml(column.label)}</th>`)
        .join("");
      const body = sheet.rows
        .map(
          (row) =>
            `<tr>${columns
              .map(
                (column) =>
                  `<td class="${column.align === "end" ? "num" : ""}">${escapeHtml(formatCell(row[column.key], column, language))}</td>`
              )
              .join("")}</tr>`
        )
        .join("");
      return `<section><h2>${escapeHtml(sheet.name || "")}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="${rtl ? "ar" : "en"}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || "")}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Cairo", "Tajawal", "Segoe UI", system-ui, sans-serif; color: #14181d; margin: 0; }
  header { border-bottom: 2px solid #14181d; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .meta { font-size: 11px; color: #5a636e; }
  section { margin: 0 0 16px; break-inside: auto; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #5a636e; margin: 0 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #d7dce2; padding: 4px 6px; text-align: ${rtl ? "right" : "left"}; }
  th { background: #eef1f4; font-weight: 700; }
  /* Repeat the header on every printed page of a long table. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  td.num, th.num { text-align: ${rtl ? "left" : "right"}; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  footer { margin-top: 12px; border-top: 1px solid #d7dce2; padding-top: 6px; font-size: 9px; color: #7b848f; display: flex; justify-content: space-between; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title || "")}</h1>
  ${subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : ""}
  ${filterSummary ? `<div class="meta">${escapeHtml(filterSummary)}</div>` : ""}
</header>
${tables}
<footer><span>${escapeHtml(brand || "")}</span><span>${escapeHtml(stamp())}</span></footer>
</body>
</html>`;
};

/* ------------------------------------------------------------------- entry point */

export const EXPORT_FORMATS = Object.freeze(["pdf", "xlsx", "csv", "print"]);

/**
 * Export one report.
 *
 * Returns nothing on success and throws on failure, so the caller can surface a real
 * error rather than a silently missing file.
 */
export const exportReport = async ({
  format,
  title,
  subtitle = "",
  filterSummary = "",
  brand = "",
  sheets = [],
  language = "en",
  fileName,
}) => {
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`Unknown export format: ${format}`);

  const usable = sheets.filter((sheet) => Array.isArray(sheet?.rows) && sheet.rows.length && Array.isArray(sheet?.columns));
  if (!usable.length) throw new Error("NOTHING_TO_EXPORT");

  const base = safeFileName(fileName || title || "report");
  const payload = { sheets: usable, language, title, subtitle, filterSummary, brand };

  if (format === "csv") {
    download(new Blob([buildCsv(payload)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
    return;
  }
  if (format === "xlsx") {
    download(await buildXlsx(payload), `${base}.xlsx`);
    return;
  }
  if (format === "pdf") {
    const doc = await buildPdf(payload);
    doc.save(`${base}.pdf`);
    return;
  }

  const win = window.open("", "_blank", "noopener,width=1100,height=760");
  if (!win) throw new Error("PRINT_WINDOW_BLOCKED");
  win.document.write(buildPrintDocument(payload));
  win.document.close();
  win.focus();
  // Let the browser lay the document out (and shape the Arabic) before the dialog opens;
  // calling print() synchronously prints a blank page in Chrome.
  win.setTimeout(() => win.print(), 250);
};

export default exportReport;
