import i18n from "../../i18n/i18n";

export const PRINT_FONT_STACK =
  '"Cairo", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';

export const normalizePrintLanguage = (language) =>
  String(language || i18n.resolvedLanguage || i18n.language || "en").toLowerCase().startsWith("ar") ? "ar" : "en";

export const getPrintDirection = (language) => (normalizePrintLanguage(language) === "ar" ? "rtl" : "ltr");

export const hasArabicText = (value) => /[\u0600-\u06FF]/.test(String(value ?? ""));

export const documentHasArabicText = (value) => {
  if (Array.isArray(value)) return value.some(documentHasArabicText);
  if (value && typeof value === "object") return Object.values(value).some(documentHasArabicText);
  return hasArabicText(value);
};

export const tPrint = (key, fallback, options = {}) =>
  i18n.t(key, {
    defaultValue: fallback,
    ...options,
  });

export const formatPrintDate = (value, language, options = {}) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(normalizePrintLanguage(language) === "ar" ? "ar-EG" : "en-US", {
    numberingSystem: "latn",
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
};

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const printDocumentCss = ({ thermal = false } = {}) => `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    background: #f4f4f5;
    color: #111827;
    font-family: ${PRINT_FONT_STACK};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    padding: ${thermal ? "0" : "18px"};
    direction: var(--print-dir);
    text-align: start;
  }
  [dir="rtl"] {
    direction: rtl;
    text-align: right;
  }
  [dir="ltr"] {
    direction: ltr;
    text-align: left;
  }
  .print-sheet {
    width: ${thermal ? "80mm" : "min(100%, 780px)"};
    max-width: ${thermal ? "80mm" : "780px"};
    margin: 0 auto;
    background: #fff;
    padding: ${thermal ? "3.2mm" : "18px"};
    border: ${thermal ? "0" : "1px solid #e5e7eb"};
    border-radius: ${thermal ? "0" : "18px"};
  }
  .print-header {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid #059669;
    padding-bottom: 10px;
  }
  .print-title {
    color: #047857;
    font-size: ${thermal ? "15px" : "26px"};
    font-weight: 900;
    line-height: 1.2;
  }
  .print-card {
    border: 1px solid #e5e7eb;
    border-radius: ${thermal ? "8px" : "12px"};
    padding: ${thermal ? "7px" : "10px"};
    margin-top: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    table-layout: fixed;
    direction: inherit;
  }
  th, td {
    border-bottom: 1px solid #e5e7eb;
    padding: ${thermal ? "4px 2px" : "8px"};
    font-size: ${thermal ? "10px" : "12px"};
    line-height: 1.4;
    text-align: start;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  th {
    background: #f8fafc;
    color: #475569;
    font-weight: 900;
  }
  .amount,
  .number,
  .sku,
  .barcode {
    direction: ltr;
    unicode-bidi: isolate;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .muted { color: #64748b; }
  .total { color:#047857; font-weight:900; font-size:${thermal ? "13px" : "18px"}; }
  .policy { text-align:center; font-size:${thermal ? "9px" : "11px"}; font-weight:800; }
  .green-line { height:1px; background:#059669; margin:6px 0; }
  .print-footer { text-align:center; font-size:${thermal ? "8px" : "10px"}; font-weight:800; color:#475569; }
  .no-print { display: inline-flex; }
  @page { margin: ${thermal ? "0" : "8mm"}; size: ${thermal ? "80mm auto" : "auto"}; }
  @media print {
    html, body { background: #fff !important; }
    body { padding: 0 !important; }
    .print-sheet { box-shadow: none !important; }
    .no-print { display: none !important; }
  }
`;

export const wrapPrintableHtml = ({ title, body, language, thermal = false }) => {
  const normalized = normalizePrintLanguage(language);
  const dir = getPrintDirection(normalized);
  return `<!doctype html>
    <html lang="${normalized}" dir="${dir}" style="--print-dir:${dir}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${escapeHtml(title || tPrint("common.print", "Print"))}</title>
        <style>${printDocumentCss({ thermal })}</style>
      </head>
      <body>${body}</body>
    </html>`;
};

export const openPrintHtml = (html, { width = 980, height = 1200 } = {}) => {
  if (typeof window === "undefined") return false;
  const popup = window.open("", "_blank", `noopener,noreferrer,width=${width},height=${height}`);
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => {
    popup.print();
    popup.close();
  }, 160);
  return true;
};
