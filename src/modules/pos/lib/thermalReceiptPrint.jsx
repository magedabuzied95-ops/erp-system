import { ReceiptPreview } from "../components/CartSidebar";
import { importWithChunkRetry } from "../../../shared/utils/chunkLoadRecovery";

const activePrintJobs = new Map();
let receiptRendererPromise = null;

export const PRINT_RENDERER_UNAVAILABLE = "PRINT_RENDERER_UNAVAILABLE";
const RENDERER_RETRY_DELAY_MS = 1500;
const IMAGE_LOAD_WAIT_MS = 1200;
const PRINT_LOG_LIMIT = 50;

/*
 * Support telemetry for "the printer sometimes does nothing after an order".
 * No console output and no server call: every phase of every print is kept in a
 * small in-memory ring buffer that support can read from the till's devtools as
 * `window.__posPrintLog`.
 */
const printLog = [];
const recordPrintPhase = (phase, details = {}) => {
  try {
    printLog.push({ phase: `pos.print.${phase}`, at: new Date().toISOString(), ...details });
    if (printLog.length > PRINT_LOG_LIMIT) printLog.splice(0, printLog.length - PRINT_LOG_LIMIT);
    if (typeof window !== "undefined") window.__posPrintLog = printLog;
  } catch {
    // Telemetry must never break a print.
  }
};

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const elapsedMs = (startedAt) => Math.round(nowMs() - startedAt);

// react-dom/server is a lazily loaded chunk. A CDN-cached 404 is retried past by
// importWithChunkRetry (recover:false -- never reload the page under a sale), and
// a plain network blink gets one more attempt 1.5 s later before the print is
// reported failed with a code the till can offer a reprint for.
const loadReceiptRenderer = () => importWithChunkRetry(() => import("react-dom/server"), { recover: false });

const getReceiptRenderer = () => {
  if (!receiptRendererPromise) {
    receiptRendererPromise = loadReceiptRenderer()
      .catch(() => new Promise((resolve) => setTimeout(resolve, RENDERER_RETRY_DELAY_MS)).then(loadReceiptRenderer))
      .catch((error) => {
        receiptRendererPromise = null;
        const unavailable = new Error(PRINT_RENDERER_UNAVAILABLE);
        unavailable.code = PRINT_RENDERER_UNAVAILABLE;
        unavailable.cause = error;
        throw unavailable;
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

// Each image gets a short, bounded wait: a slow product photo must not hold the
// receipt back long enough for the cashier to think the printer dropped out.
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
          window.setTimeout(finish, IMAGE_LOAD_WAIT_MS);
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
  const invoice = String(receiptProps?.invoiceNumber || "");
  const importStartedAt = nowMs();
  const { renderToStaticMarkup } = await getReceiptRenderer();
  recordPrintPhase("import_ms", { invoice, ms: elapsedMs(importStartedAt) });
  const renderStartedAt = nowMs();
  const receiptHtml = renderToStaticMarkup(<ReceiptPreview {...receiptProps} compact />);
  recordPrintPhase("render_ms", { invoice, ms: elapsedMs(renderStartedAt) });
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
    const imagesStartedAt = nowMs();
    await waitForImages(frameDocument);
    recordPrintPhase("images_ms", { transport, ms: elapsedMs(imagesStartedAt), images: frameDocument?.images?.length || 0 });
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
    recordPrintPhase("start", { invoice: invoiceNumber, silent });
    try {
      const html = await renderReceiptDocument(receiptProps);
      let result;
      if (!silent) result = await printInFrame(html, "browser-preview");
      else if (await invokeNativeSilentPrinter(html, receiptProps)) result = { transport: "native-silent" };
      else result = await printInFrame(html, "browser-kiosk");
      recordPrintPhase("done", { invoice: invoiceNumber, transport: result?.transport || "" });
      return result;
    } catch (error) {
      recordPrintPhase("error", { invoice: invoiceNumber, code: error?.code || "", message: String(error?.message || error || "") });
      throw error;
    }
  })();

  activePrintJobs.set(jobKey, job);
  try {
    return await job;
  } finally {
    window.setTimeout(() => activePrintJobs.delete(jobKey), 1200);
  }
};
