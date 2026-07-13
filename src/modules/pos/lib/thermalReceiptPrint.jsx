import { ReceiptPreview } from "../components/CartSidebar";

const activePrintJobs = new Map();
let receiptRendererPromise = null;

const getReceiptRenderer = () => {
  if (!receiptRendererPromise) {
    receiptRendererPromise = import("react-dom/server").catch((error) => {
      receiptRendererPromise = null;
      throw error;
    });
  }
  return receiptRendererPromise;
};

export const warmThermalReceiptPrinter = () => {
  void getReceiptRenderer().catch(() => {});
};

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const waitForImages = async (documentRef) => {
  const images = Array.from(documentRef?.images || []);
  if (!images.length) return;
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          const finish = () => resolve();
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          window.setTimeout(finish, 2500);
        });
      }
      if (typeof image.decode === "function" && image.naturalWidth > 0) {
        await Promise.race([
          image.decode().catch(() => {}),
          new Promise((resolve) => window.setTimeout(resolve, 1000)),
        ]);
      }
    })
  );
};

export const buildThermalPrintDocument = ({ receiptHtml, title = "Sales Receipt", lang = "ar", dir = "rtl" }) => `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${escapeHtml(dir)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; min-width: 0; margin: 0; padding: 0; overflow: visible; background: #fff; color: #000; }
      body { font-family: Arial, Tahoma, "Segoe UI", sans-serif; }
      /* Chromium ignores an automatic page length; the thermal driver owns the roll length. */
      @page { margin: 0; }
      @media print {
        html, body { width: 100% !important; min-width: 0 !important; margin: 0 !important; padding: 0 !important; }
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>${receiptHtml}</body>
</html>`;

const renderReceiptDocument = async (receiptProps) => {
  const { renderToStaticMarkup } = await getReceiptRenderer();
  const receiptHtml = renderToStaticMarkup(<ReceiptPreview {...receiptProps} compact />);
  const invoiceNumber = receiptProps?.invoiceNumber || "Sales Receipt";
  return buildThermalPrintDocument({
    receiptHtml,
    title: invoiceNumber,
    lang: document.documentElement.lang || "ar",
    dir: document.documentElement.dir || "rtl",
  });
};

const invokeNativeSilentPrinter = async (html, receiptProps) => {
  const payload = {
    html,
    documentName: String(receiptProps?.invoiceNumber || "Sales Receipt"),
    paperWidthMm: 80,
    silent: true,
  };
  const printer = window.posPrinter || window.erpPrinter || window.electronAPI?.printer;
  if (typeof printer?.printReceipt === "function") {
    await printer.printReceipt(payload);
    return true;
  }
  if (typeof printer?.printHtml === "function") {
    await printer.printHtml(payload);
    return true;
  }
  return false;
};

const printInFrame = async (html, transport) => {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    right: "0",
    bottom: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(frame);
  try {
    const frameDocument = frame.contentDocument;
    frameDocument.open();
    frameDocument.write(html);
    frameDocument.close();
    await waitForImages(frameDocument);
    frame.contentWindow.focus();
    frame.contentWindow.print();
    return { transport };
  } finally {
    window.setTimeout(() => frame.remove(), 1500);
  }
};

/**
 * The single POS receipt printing entry point.
 * Silent printing uses an installed native bridge when available, otherwise the
 * browser's kiosk-printing transport. Standard browsers may still show their
 * protected print dialog unless launched with kiosk printing enabled.
 */
export const printThermalReceipt = async (receiptProps, { silent = false } = {}) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("PRINT_UNAVAILABLE");
  }
  const invoiceNumber = String(receiptProps?.invoiceNumber || "").trim();
  if (!invoiceNumber) throw new Error("MISSING_INVOICE_NUMBER");
  const jobKey = `${silent ? "silent" : "preview"}:${invoiceNumber}`;
  if (activePrintJobs.has(jobKey)) return activePrintJobs.get(jobKey);
  const job = (async () => {
    const html = await renderReceiptDocument(receiptProps);
    if (!silent) return printInFrame(html, "browser-preview");
    if (await invokeNativeSilentPrinter(html, receiptProps)) return { transport: "native-silent" };
    return printInFrame(html, "browser-kiosk");
  })();

  activePrintJobs.set(jobKey, job);
  try {
    return await job;
  } finally {
    window.setTimeout(() => activePrintJobs.delete(jobKey), 1200);
  }
};
