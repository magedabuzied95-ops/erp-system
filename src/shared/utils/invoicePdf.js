import { APP_NAME } from "../constants/app";
import { formatCurrency } from "../lib/currency";
import { DEFAULT_PRODUCT_PLACEHOLDER, resolveInvoiceItemImageUrl } from "../lib/invoiceItemImages";
import {
  documentHasArabicText,
  escapeHtml,
  formatPrintDate,
  getPrintDirection,
  normalizePrintLanguage,
  openPrintHtml,
  tPrint,
  wrapPrintableHtml,
} from "./printLocalization";

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const GREEN = [5, 150, 105];
const LIGHT_BORDER = [226, 232, 240];
const DEFAULT_SOCIAL_LINKS = {
  googleReviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
  facebookReviewUrl: "https://www.facebook.com/MONESHOESSTORE/reviews",
  instagramUrl: "https://www.instagram.com/m1store_eg/",
};

const p = (key, fallback, options) => tPrint(`print.invoice.${key}`, fallback, options);

const resolveItemPrice = (item = {}) => {
  const quantity = Math.max(1, Number(item.quantity || 0));
  const candidates = [
    item.price,
    item.unit_price,
    item.sale_price,
    item.product_price,
    item.variant_price,
    item.total && Number(item.total) > 0 ? Number(item.total) / quantity : null,
    item.total_amount && Number(item.total_amount) > 0 ? Number(item.total_amount) / quantity : null,
  ];
  return candidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
};

const formatInvoiceItemMoney = (value) => (Number(value || 0) > 0 ? formatCurrency(value) : p("notSpecified", "Not specified"));

const getInvoiceSupportPhone = (invoice = {}) =>
  invoice.companyPhone || invoice.storePhone || invoice.supportPhone || invoice.customerServicePhone || "01234567890";

const getInvoiceWebsite = (invoice = {}) =>
  invoice.companyWebsite || invoice.website || invoice.storeWebsite || "www.workspace.com";

const getPublicAppUrl = () => {
  const selected = [
    import.meta.env.VITE_PUBLIC_APP_URL,
    import.meta.env.PUBLIC_APP_URL,
    import.meta.env.FRONTEND_URL,
  ]
    .map((value) => String(value || "").trim())
    .find((value) => value && !/localhost|127\.0\.0\.1/i.test(value));
  if (selected) return selected.replace(/\/$/, "");
  const win = safeWindow();
  if (win && !/localhost|127\.0\.0\.1/i.test(win.location.hostname)) return win.location.origin.replace(/\/$/, "");
  return "";
};

const getPublicInvoiceUrl = (invoice = {}) => {
  const raw = invoice.publicInvoiceUrl || invoice.public_invoice_url || invoice.invoiceUrl || "";
  if (raw && /^https?:\/\//i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw)) return raw;
  const baseUrl = getPublicAppUrl();
  const token = invoice.publicToken || invoice.public_token || invoice.invoiceNumber || invoice.invoice_number || "";
  return baseUrl && token ? `${baseUrl}/invoice/${encodeURIComponent(token)}` : "";
};

const getPaymentLabel = (invoice = {}) => {
  const raw = String(invoice.payment?.method || invoice.payment_method || invoice.totals?.payment_method || "").toLowerCase();
  const labels = {
    cash: p("cash", "Cash"),
    card: p("card", "Card"),
    visa: p("card", "Card"),
    wallet: p("wallet", "Wallet"),
    split: p("split", "Split"),
    transfer: p("transfer", "Transfer"),
    bank_transfer: p("transfer", "Transfer"),
  };
  return labels[raw] || (raw ? raw : p("cash", "Cash"));
};

const getSellerName = (invoice = {}) => {
  const seller = invoice.salesman_name || invoice.sales_name || invoice.seller_name || invoice.sellerName || invoice.salesName;
  if (!seller || /cashieradmin/i.test(String(seller))) return "";
  return seller;
};

const getSocialLinks = (invoice = {}) => [
  { key: "google", label: p("rateGoogle", "Rate us on Google"), url: invoice.google_review_url || invoice.googleReviewUrl || DEFAULT_SOCIAL_LINKS.googleReviewUrl },
  { key: "facebook", label: p("rateFacebook", "Rate us on Facebook"), url: invoice.facebook_review_url || invoice.facebookReviewUrl || DEFAULT_SOCIAL_LINKS.facebookReviewUrl },
  { key: "instagram", label: p("followInstagram", "Follow us on Instagram"), url: invoice.instagram_url || invoice.instagramUrl || DEFAULT_SOCIAL_LINKS.instagramUrl },
].filter((link) => link.url && /^https?:\/\//i.test(link.url) && !/localhost|127\.0\.0\.1/i.test(link.url));

const normalizeItems = (items = [], format = "a4") =>
  items.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const price = resolveItemPrice(item);
    const discount = Number(item.discount_amount ?? item.lineDiscount ?? 0);
    const variant = [item.size, item.color].filter(Boolean).join(" / ") || p("notSpecified", "Not specified");
    const name = item.product_name || item.name || p("item", "Item {{index}}", { index: index + 1 });
    return {
      name,
      variant,
      quantity,
      price,
      discount,
      image: resolveInvoiceItemImageUrl(item, ""),
      total: Number(item.total_amount || item.total || Math.max(0, price * quantity - discount)),
      label: format === "thermal" ? `${name}\n${variant}` : name,
    };
  });

const buildInvoicePrintHtml = (invoice = {}, format = "a4", language) => {
  const normalized = normalizePrintLanguage(language);
  const thermal = format === "thermal";
  const dir = getPrintDirection(normalized);
  const items = normalizeItems(invoice.items || [], format);
  const invoiceNumber = invoice.barcodeValue || invoice.invoiceNumber || "000000";
  const supportPhone = getInvoiceSupportPhone(invoice);
  const website = getInvoiceWebsite(invoice);
  const publicUrl = getPublicInvoiceUrl(invoice);
  const social = getSocialLinks(invoice)
    .map((link) => `<a class="pill" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`)
    .join("");
  const rows = items
    .map(
      (item) => `
        <tr>
          <td>${!thermal ? `<img src="${escapeHtml(item.image || DEFAULT_PRODUCT_PLACEHOLDER)}" alt="" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_PLACEHOLDER}'" style="width:42px;height:42px;object-fit:cover;border-radius:10px;background:#f1f5f9;margin-inline-end:8px;vertical-align:middle" />` : ""}<strong>${escapeHtml(item.name)}</strong><br><small class="muted">${escapeHtml(item.variant)}</small></td>
          ${thermal ? "" : `<td>${escapeHtml(item.variant)}</td>`}
          <td class="number">${escapeHtml(item.quantity)}</td>
          ${thermal ? "" : `<td class="amount">${escapeHtml(formatInvoiceItemMoney(item.price))}</td>`}
          <td class="amount">${escapeHtml(formatCurrency(item.total))}</td>
        </tr>
      `
    )
    .join("");
  const discount =
    Number(invoice.totals?.discount || 0) +
    Number(invoice.totals?.itemDiscountTotal || 0) +
    Number(invoice.totals?.invoiceDiscount || 0) +
    Number(invoice.totals?.loyaltyDiscount || 0);
  const service = Number(invoice.totals?.service || invoice.totals?.serviceFee || 0);
  const seller = getSellerName(invoice);
  const createdAt = invoice.createdAt || Date.now();
  const body = `
    <main class="print-sheet" dir="${dir}">
      <section class="print-header">
        <div>
          <div class="print-title">${escapeHtml(p("salesInvoice", "Sales invoice"))}</div>
          <div class="muted">${escapeHtml(p("orderNumber", "Order number"))}: <span class="number">${escapeHtml(invoice.invoiceNumber || "n/a")}</span></div>
          <div class="muted">${escapeHtml(p("date", "Date"))}: ${escapeHtml(formatPrintDate(createdAt, normalized, { dateStyle: "medium", timeStyle: undefined }))}</div>
          <div class="muted">${escapeHtml(p("time", "Time"))}: ${escapeHtml(formatPrintDate(createdAt, normalized, { dateStyle: undefined, timeStyle: "short" }))}</div>
        </div>
        <div>
          <strong>${escapeHtml(invoice.companyName || APP_NAME)}</strong><br>
          <span class="muted">${escapeHtml(invoice.companyTagline || p("premiumShoes", "Premium Shoes"))}</span>
        </div>
      </section>
      <section class="print-card">
        <strong>${escapeHtml(p("customerDetails", "Customer details"))}</strong><br>
        ${escapeHtml(p("customer", "Customer"))}: ${escapeHtml(invoice.customerName || p("walkInCustomer", "Walk-in customer"))}<br>
        ${invoice.customerPhone ? `${escapeHtml(p("phone", "Phone"))}: <span class="number">${escapeHtml(invoice.customerPhone)}</span><br>` : ""}
        ${seller ? `${escapeHtml(p("seller", "Seller"))}: ${escapeHtml(seller)}<br>` : ""}
        ${escapeHtml(p("paymentMethod", "Payment method"))}: ${escapeHtml(getPaymentLabel(invoice))}
      </section>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(p("product", "Product"))}</th>
            ${thermal ? "" : `<th>${escapeHtml(p("variant", "Size / color"))}</th>`}
            <th class="number">${escapeHtml(p("quantity", "Qty"))}</th>
            ${thermal ? "" : `<th class="amount">${escapeHtml(p("price", "Price"))}</th>`}
            <th class="amount">${escapeHtml(p("total", "Total"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <section class="print-card">
        <div>${escapeHtml(p("subtotal", "Subtotal"))}: <span class="amount">${escapeHtml(formatCurrency(invoice.totals?.subtotal || 0))}</span></div>
        ${discount > 0 ? `<div>${escapeHtml(p("discount", "Discount"))}: <span class="amount">- ${escapeHtml(formatCurrency(discount))}</span></div>` : ""}
        ${service > 0 ? `<div>${escapeHtml(p("service", "Service"))}: <span class="amount">${escapeHtml(formatCurrency(service))}</span></div>` : ""}
        <div>${escapeHtml(p("itemsCount", "Items count"))}: <span class="number">${items.length}</span></div>
        <div>${escapeHtml(p("quantityTotal", "Total quantity"))}: <span class="number">${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</span></div>
        <div class="total">${escapeHtml(p("finalTotal", "Final total"))}: <span class="amount">${escapeHtml(formatCurrency(invoice.totals?.total || 0))}</span></div>
      </section>
      <section class="print-card policy">${escapeHtml(p("returnPolicy", "يتم قبول الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام وفق الشروط المعتمدة."))}</section>
      ${social ? `<section class="print-card" style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">${social}</section>` : ""}
      <footer class="print-footer">
        <div class="barcode">${escapeHtml(invoiceNumber)}</div>
        <div class="green-line"></div>
        <span class="number">${escapeHtml(website)}</span> | ${escapeHtml(p("customerService", "Customer service"))} - <span class="number">${escapeHtml(supportPhone)}</span> ${publicUrl ? "| QR" : ""}
      </footer>
    </main>`;
  return wrapPrintableHtml({ title: invoice.invoiceNumber || p("salesInvoice", "Sales invoice"), body, language: normalized, thermal });
};

const openFallbackWindow = (html, format = "a4") => openPrintHtml(html, { width: format === "thermal" ? 420 : 980, height: 1200 });

const shouldUseHtmlRenderer = (invoice, language) =>
  normalizePrintLanguage(language) === "ar" || documentHasArabicText(invoice);

const drawEnglishPdf = async ({ format, invoice, filename }) => {
  const [jspdfModule, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
  const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
  if (!JsPDF || !autoTable) throw new Error("PDF library unavailable");

  const isThermal = format === "thermal";
  const doc = new JsPDF({
    orientation: "portrait",
    unit: "mm",
    format: isThermal ? [80, 250] : "a4",
    compress: true,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = isThermal ? 4 : 12;
  const now = new Date(invoice.createdAt || Date.now());

  doc.setProperties({
    title: invoice.invoiceNumber || p("salesInvoice", "Sales invoice"),
    subject: p("salesInvoice", "Sales invoice"),
    author: invoice.companyName || APP_NAME,
  });

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 11 : 18);
  doc.text(p("salesInvoice", "Sales invoice"), margin, margin + 6);
  doc.setFontSize(isThermal ? 7 : 9);
  doc.setFont("helvetica", "normal");
  doc.text(`${p("orderNumber", "Order number")}: ${invoice.invoiceNumber || "n/a"}`, margin, margin + 12);
  doc.text(`${p("date", "Date")}: ${formatPrintDate(now, "en")}`, margin, margin + 17);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(invoice.companyName || APP_NAME, pageWidth - margin, margin + 6, { align: "right" });
  doc.setDrawColor(...GREEN);
  doc.line(margin, margin + 22, pageWidth - margin, margin + 22);

  const items = normalizeItems(invoice.items || [], format);
  autoTable(doc, {
    startY: margin + 28,
    head: isThermal
      ? [[p("product", "Product"), p("quantity", "Qty"), p("total", "Total")]]
      : [[p("product", "Product"), p("variant", "Size / color"), p("quantity", "Qty"), p("price", "Price"), p("total", "Total")]],
    body: isThermal
      ? items.map((item) => [item.label, String(item.quantity), formatCurrency(item.total)])
      : items.map((item) => [item.name, item.variant, String(item.quantity), formatInvoiceItemMoney(item.price), formatCurrency(item.total)]),
    theme: "plain",
    margin: { left: margin, right: margin, top: 0, bottom: 8 },
    styles: {
      font: "helvetica",
      fontSize: isThermal ? 6.2 : 8,
      cellPadding: isThermal ? 1.1 : 1.8,
      valign: "middle",
      lineColor: LIGHT_BORDER,
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [248, 250, 252],
      textColor: [71, 85, 105],
      fontStyle: "bold",
    },
  });

  const y = (doc.lastAutoTable?.finalY || margin + 40) + 8;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(`${p("finalTotal", "Final total")}: ${formatCurrency(invoice.totals?.total || 0)}`, pageWidth - margin, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(isThermal ? 6 : 8);
  doc.text(p("returnPolicy", "يتم قبول الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام وفق الشروط المعتمدة."), pageWidth / 2, y + 8, {
    align: "center",
    maxWidth: pageWidth - margin * 2,
  });
  doc.save(filename || `${invoice.invoiceNumber || "invoice"}.pdf`);
  return { ok: true };
};

export const downloadInvoicePdf = async ({
  format = "a4",
  invoice = {},
  filename,
  onFallback,
  language,
} = {}) => {
  const resolvedLanguage = normalizePrintLanguage(language);
  const html = buildInvoicePrintHtml(invoice, format, resolvedLanguage);

  if (shouldUseHtmlRenderer(invoice, resolvedLanguage)) {
    if (typeof onFallback === "function") return onFallback({ html, reason: "rtl-html-renderer" });
    return { ok: openFallbackWindow(html, format), htmlPrint: true };
  }

  try {
    return await drawEnglishPdf({ format, invoice, filename });
  } catch (error) {
    console.warn("PDF generation fallback:", error);
    if (typeof onFallback === "function") return onFallback({ html, error });
    return { ok: false, error, fallbackOpened: openFallbackWindow(html, format) };
  }
};
