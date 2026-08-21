import { formatCurrency } from "../lib/currency";
import { DEFAULT_PRODUCT_PLACEHOLDER, resolveInvoiceItemImageUrl } from "../lib/invoiceItemImages";
import { resolveBrandImageUrl } from "../lib/imageUrls";
import { normalizeInvoicePaymentBreakdown } from "./invoicePaymentBreakdown";
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
import { getInvoiceTemplateConfig } from "../hooks/useInvoiceTemplate";
import { invoiceTemplateForOutput } from "../../../shared/invoiceTemplate.js";
import { blocksForOutput } from "../../../shared/invoiceBlocks.js";
import { renderInvoiceBlockHtml } from "./invoiceBlockHtml";

const GREEN = [5, 150, 105];
const LIGHT_BORDER = [226, 232, 240];
const M1_STORE_NAME = "M1 Store";
// The phone, website, review links and return policy that used to sit here as
// constants are now template fields (shared/invoiceTemplate.js). Their defaults are
// these exact values, so a store that has configured nothing prints the same sheet.

const safeWindow = () => (typeof window !== "undefined" ? window : null);

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

const formatInvoiceItemMoney = (value) => (Number(value || 0) > 0 ? formatCurrency(value) : "غير محدد");

const getInvoiceSupportPhone = (invoice = {}, tpl) =>
  invoice.companyPhone || invoice.storePhone || invoice.supportPhone || invoice.customerServicePhone || tpl?.identity?.phone || "";

const getInvoiceWebsite = (invoice = {}, tpl) =>
  invoice.companyWebsite || invoice.website || invoice.storeWebsite || tpl?.identity?.website_text || "";

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

const getStoreLogoUrl = (invoice = {}) =>
  resolveBrandImageUrl(String(
    invoice.store?.logoUrl ||
    invoice.store?.logo_url ||
    invoice.logoUrl ||
    invoice.logo_url ||
    invoice.company_logo_url ||
    invoice.companyLogoUrl ||
    ""
  ).trim());

const renderStoreLogoMarkup = (invoice = {}, tpl) => {
  if (tpl?.identity?.show_logo === false) return "";
  const storeName = tpl?.identity?.store_name || invoice.store?.name || invoice.companyName || M1_STORE_NAME;
  const logoUrl = tpl?.identity?.logo_url || getStoreLogoUrl(invoice);
  if (logoUrl) {
    return `
      <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(storeName)}" onerror="this.style.display='none'" style="display:block;width:18mm;height:18mm;object-fit:contain;margin-bottom:4px" />
    `;
  }
  // No logo: the store's initials stand in, so the sheet still opens with an identity.
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:18mm;height:18mm;margin-bottom:4px;border:1px solid #d1d5db;border-radius:9999px;font-weight:900;font-size:12px;line-height:1">${escapeHtml(storeName)}</span>`;
};

const getPaymentLabel = (invoice = {}) => {
  const raw = String(invoice.payment?.method || invoice.payment_method || invoice.totals?.payment_method || "").toLowerCase();
  const labels = {
    cash: "نقدًا",
    cod: "الدفع عند الاستلام",
    card: "بطاقة",
    visa: "بطاقة",
    wallet: "محفظة",
    customer_wallet: "محفظة العميل",
    instapay: "InstaPay",
    vodafone_cash: "Vodafone Cash",
    split: "دفع متعدد",
    transfer: "تحويل",
    bank_transfer: "تحويل بنكي",
  };
  return labels[raw] || (raw ? raw : "نقدًا");
};

const getSellerName = (invoice = {}) => {
  const seller = invoice.salesman_name || invoice.sales_name || invoice.seller_name || invoice.sellerName || invoice.salesName;
  if (!seller || /cashieradmin/i.test(String(seller))) return "";
  return seller;
};

const getSocialLinks = (invoice = {}, tpl) => {
  if (!tpl?.social?.enabled) return [];
  return [
    { key: "google", label: "قيّمنا على Google", url: invoice.google_review_url || invoice.googleReviewUrl || tpl.social.google_review_url },
    { key: "facebook", label: "قيّمنا على Facebook", url: invoice.facebook_review_url || invoice.facebookReviewUrl || tpl.social.facebook_review_url },
    { key: "instagram", label: "تابعنا على Instagram", url: invoice.instagram_url || invoice.instagramUrl || tpl.social.instagram_url },
  ].filter((link) => link.url && /^https?:\/\//i.test(link.url) && !/localhost|127\.0\.0\.1/i.test(link.url));
};

const normalizeItems = (items = [], format = "a4") =>
  items.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const price = resolveItemPrice(item);
    const discount = Number(item.discount_amount ?? item.lineDiscount ?? 0);
    const variant = [
      item.color ? `اللون: ${item.color}` : "",
      item.size ? `المقاس: ${item.size}` : "",
    ].filter(Boolean).join(" / ") || "غير محدد";
    const name = item.product_name || item.name || `منتج ${index + 1}`;
    return {
      name,
      variant,
      quantity,
      price,
      discount,
      sku: item.sku || item.barcode || "",
      image: resolveInvoiceItemImageUrl(item, ""),
      total: Number(item.total_amount || item.total || Math.max(0, price * quantity - discount)),
      label: format === "thermal" ? `${name}\n${variant}` : name,
    };
  });

const buildInvoicePrintHtml = (invoice = {}, format = "a4", language, template = null) => {
  const normalized = normalizePrintLanguage(language);
  const thermal = format === "thermal";
  // The 80mm roll inherits the A4 overrides and then drops what does not fit.
  const tpl = invoiceTemplateForOutput(template || {}, thermal ? "thermal" : "print");
  const show = tpl.fields;
  const showTotals = tpl.totals;
  const dir = getPrintDirection(normalized);
  const items = normalizeItems(invoice.items || [], format);
  const invoiceNumber = invoice.barcodeValue || invoice.invoiceNumber || "000000";
  const supportPhone = getInvoiceSupportPhone(invoice, tpl);
  const websiteText = getInvoiceWebsite(invoice, tpl);
  const websiteHref = tpl.identity.website_url;
  const returnPolicyHtml = tpl.footer.return_policy_enabled
    ? String((normalized === "en" && tpl.footer.return_policy_en) || tpl.footer.return_policy_ar || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join("")
    : "";
  const publicUrl = getPublicInvoiceUrl(invoice);
  const social = getSocialLinks(invoice, tpl)
    .map((link) => `<a class="pill" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`)
    .join("");
  const rows = items.map((item) => `
    <tr>
      <td>${!thermal && show.show_product_image ? `<img src="${escapeHtml(item.image || DEFAULT_PRODUCT_PLACEHOLDER)}" alt="" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_PLACEHOLDER}'" style="width:42px;height:42px;object-fit:cover;border-radius:10px;background:#f1f5f9;margin-inline-end:8px;vertical-align:middle" />` : ""}<strong>${escapeHtml(item.name)}</strong>${show.show_product_variant ? `<br><small class="muted">${escapeHtml(item.variant)}</small>` : ""}${show.show_sku && item.sku ? `<br><small class="muted">${escapeHtml(tPrint("print.invoice.sku", "SKU"))} ${escapeHtml(item.sku)}</small>` : ""}</td>
      ${thermal || !show.show_product_variant ? "" : `<td>${escapeHtml(item.variant)}</td>`}
      <td class="number">${escapeHtml(item.quantity)}</td>
      ${thermal || !show.show_unit_price ? "" : `<td class="amount">${escapeHtml(formatInvoiceItemMoney(item.price))}</td>`}
      <td class="amount">${escapeHtml(formatCurrency(item.total))}</td>
    </tr>
  `).join("");
  const discount =
    Number(invoice.totals?.discount || 0) +
    Number(invoice.totals?.itemDiscountTotal || 0) +
    Number(invoice.totals?.invoiceDiscount || 0) +
    Number(invoice.totals?.loyaltyDiscount || 0);
  const shipping = Number(invoice.totals?.shipping || 0);
  const paid = Number(invoice.totals?.paidAmount ?? invoice.totals?.paid_amount ?? invoice.totals?.paid ?? invoice.paid_amount ?? 0);
  const remaining = Math.max(0, Number(invoice.totals?.remainingAmount ?? invoice.totals?.remaining_amount ?? invoice.totals?.remaining ?? invoice.remaining_amount ?? 0));
  const paymentBreakdown = normalizeInvoicePaymentBreakdown(
    invoice.paymentBreakdown ?? invoice.payment_breakdown ?? invoice.payments ?? invoice.payment?.paymentBreakdown
  );
  const paymentBreakdownRows = paymentBreakdown.length > 1
    ? paymentBreakdown.map((payment) => `<div>${escapeHtml(getPaymentLabel({ payment: { method: payment.method } }))}: <span class="amount">${escapeHtml(formatCurrency(payment.amount))}</span></div>`).join("")
    : "";
  const seller = getSellerName(invoice);
  const createdAt = invoice.createdAt || Date.now();
  // Same treatment as the card: each section still emits exactly the markup it emitted
  // when the order was fixed, and the sequence comes off the template's block list.
  const sectionHtml = {
    brand: `
      <section class="print-header">
        <div>
          <div class="store-mark">${renderStoreLogoMarkup(invoice, tpl)}</div>
          <div class="print-title">فاتورة طلب</div>
          <div class="muted">رقم الطلب: <span class="number">${escapeHtml(invoice.invoiceNumber || "n/a")}</span></div>
          ${show.show_order_date ? `<div class="muted">تاريخ الطلب: ${escapeHtml(formatPrintDate(createdAt, normalized, { dateStyle: "medium", timeStyle: undefined }))}</div>
          <div class="muted">الوقت: ${escapeHtml(formatPrintDate(createdAt, normalized, { dateStyle: undefined, timeStyle: "short" }))}</div>` : ""}
        </div>
        <div>
          <strong>${escapeHtml(tpl.identity.store_name || invoice.store?.name || invoice.companyName || M1_STORE_NAME)}</strong><br>
        </div>
      </section>
    `,
    customer_meta: `
      <section class="print-card">
        <strong>بيانات العميل</strong><br>
        ${show.show_customer_name ? `العميل: ${escapeHtml(invoice.customerName || "عميلنا العزيز")}<br>` : ""}
        ${show.show_customer_phone && invoice.customerPhone ? `رقم الهاتف: <span class="number">${escapeHtml(invoice.customerPhone)}</span><br>` : ""}
        ${show.show_seller_name && seller ? `البائع: ${escapeHtml(seller)}<br>` : ""}
        ${show.show_payment_method ? `طريقة الدفع: ${escapeHtml(getPaymentLabel(invoice))}` : ""}
      </section>
    `,
    items_table: `
      <table>
        <thead>
          <tr>
            <th>المنتج</th>
            ${thermal || !show.show_product_variant ? "" : `<th>اللون / المقاس</th>`}
            <th class="number">الكمية</th>
            ${thermal || !show.show_unit_price ? "" : `<th class="amount">السعر</th>`}
            <th class="amount">الإجمالي</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `,
    totals: `
      <section class="print-card">
        ${showTotals.show_subtotal ? `<div>الإجمالي الفرعي: <span class="amount">${escapeHtml(formatCurrency(invoice.totals?.subtotal || 0))}</span></div>` : ""}
        ${showTotals.show_discount && discount > 0 ? `<div>الخصم: <span class="amount">- ${escapeHtml(formatCurrency(discount))}</span></div>` : ""}
        ${showTotals.show_shipping && shipping > 0 ? `<div>الشحن: <span class="amount">${escapeHtml(formatCurrency(shipping))}</span></div>` : ""}
        <div>عدد المنتجات: <span class="number">${items.length}</span></div>
        <div>إجمالي الكمية: <span class="number">${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</span></div>
        ${showTotals.show_grand_total ? `<div class="total">الإجمالي الكلي: <span class="amount">${escapeHtml(formatCurrency(invoice.totals?.total || 0))}</span></div>` : ""}
        ${showTotals.show_payment_breakdown && paymentBreakdownRows ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1"><strong>تفاصيل الدفع</strong>${paymentBreakdownRows}</div>` : ""}
        ${showTotals.show_paid ? `<div>المدفوع: <span class="amount">${escapeHtml(formatCurrency(paid))}</span></div>` : ""}
        ${showTotals.show_remaining ? `<div>المتبقي: <span class="amount">${escapeHtml(formatCurrency(remaining))}</span></div>` : ""}
      </section>
    `,
    policy: `
      ${returnPolicyHtml ? `<section class="print-card policy">${returnPolicyHtml}</section>` : ""}
    `,
    social: `
      ${social ? `<section class="print-card" style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">${social}</section>` : ""}
    `,
    store_contact: `
      <footer class="print-footer">
        <div class="barcode">${escapeHtml(invoiceNumber)}</div>
        <div class="green-line"></div>
        ${websiteHref && websiteText ? `<a class="number" href="${escapeHtml(websiteHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(websiteText)}</a> |` : ""}
        ${supportPhone ? `<a class="number" href="tel:${escapeHtml(supportPhone)}">${escapeHtml(supportPhone)} - خدمة العملاء</a>` : ""}
        ${publicUrl ? "| QR" : ""}
      </footer>
    `,
  };

  const blockContext = {
    // The print path names the share link publicInvoiceUrl and resolves it through
    // getPublicInvoiceUrl; a QR block looks for publicUrl, so hand it the resolved one.
    invoice: { ...invoice, publicUrl },
    language: normalized,
    money: formatCurrency,
    formatDate: (value) => formatPrintDate(value, normalized, { dateStyle: "medium", timeStyle: undefined }),
    barcodeSvg: null,
  };

  const body = `
    <main class="print-sheet" dir="${dir}">
      ${blocksForOutput(tpl.blocks, thermal ? "thermal" : "print")
        .map((block) => sectionHtml[block.type] ?? renderInvoiceBlockHtml(block, blockContext))
        .join("")}
    </main>`;
  return wrapPrintableHtml({ title: invoice.invoiceNumber || "فاتورة طلب", body, language: normalized, thermal });
};

// The studio previews the real printed sheet rather than a lookalike, so it builds
// the same HTML the print path opens. Kept as a named export so the preview can never
// drift from what a customer actually receives.
export const buildInvoicePreviewHtml = (invoice = {}, format = "a4", language, template = null) =>
  buildInvoicePrintHtml(invoice, format, language, template);

const openFallbackWindow = (html, format = "a4") => openPrintHtml(html, { width: format === "thermal" ? 420 : 980, height: 1200 });

const shouldUseHtmlRenderer = (invoice, language) =>
  normalizePrintLanguage(language) === "ar" || documentHasArabicText(invoice);

const drawEnglishPdf = async ({ format, invoice, filename, template = null }) => {
  const tpl = invoiceTemplateForOutput(template || {}, format === "thermal" ? "thermal" : "print");
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
    title: invoice.invoiceNumber || "فاتورة طلب",
    subject: "فاتورة طلب",
    author: invoice.companyName || M1_STORE_NAME,
  });

  const logoUrl = getStoreLogoUrl(invoice);
  if (logoUrl) {
    try {
      const response = await fetch(logoUrl);
      if (response.ok) {
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        doc.addImage(dataUrl, "PNG", margin, margin, isThermal ? 16 : 22, isThermal ? 16 : 22, undefined, "FAST");
      }
    } catch {
      // Keep the header clean if the logo exists but fails to render.
    }
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(isThermal ? 12 : 20);
    doc.text(M1_STORE_NAME, margin, margin + (isThermal ? 7 : 8));
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 11 : 18);
  doc.text("فاتورة طلب", margin + (logoUrl ? (isThermal ? 18 : 24) : 0), margin + 6);
  doc.setFontSize(isThermal ? 7 : 9);
  doc.setFont("helvetica", "normal");
  doc.text(`رقم الطلب: ${invoice.invoiceNumber || "n/a"}`, margin, margin + 12);
  doc.text(`تاريخ الطلب: ${formatPrintDate(now, "ar")}`, margin, margin + 17);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(invoice.store?.name || invoice.companyName || M1_STORE_NAME, pageWidth - margin, margin + 6, { align: "right" });
  doc.setDrawColor(...GREEN);
  doc.line(margin, margin + 22, pageWidth - margin, margin + 22);

  const items = normalizeItems(invoice.items || [], format);
  autoTable(doc, {
    startY: margin + 28,
    head: isThermal
      ? [["المنتج", "الكمية", "الإجمالي"]]
      : [["المنتج", "اللون / المقاس", "الكمية", "السعر", "الإجمالي"]],
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
  doc.text(`الإجمالي الكلي: ${formatCurrency(invoice.totals?.total || 0)}`, pageWidth - margin, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(isThermal ? 6 : 8);
  // jsPDF lays this out as one wrapped paragraph, so the policy's line breaks
  // collapse into spaces here rather than becoming separate rows.
  const policyText = tpl.footer.return_policy_enabled
    ? String(tpl.footer.return_policy_en || tpl.footer.return_policy_ar || "").split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
    : "";
  if (policyText) {
    doc.text(policyText, pageWidth / 2, y + 8, {
      align: "center",
      maxWidth: pageWidth - margin * 2,
    });
  }
  doc.save(filename || `${invoice.invoiceNumber || "invoice"}.pdf`);
  return { ok: true };
};

export const downloadInvoicePdf = async ({
  format = "a4",
  invoice = {},
  filename,
  onFallback,
  language,
  template,
} = {}) => {
  const resolvedLanguage = normalizePrintLanguage(language);
  // Resolved once per download. The lookup is cached and falls back to the defaults,
  // so a slow or missing template endpoint delays nothing and prints the same sheet.
  const resolvedTemplate = template || (await getInvoiceTemplateConfig());
  const html = buildInvoicePrintHtml(invoice, format, resolvedLanguage, resolvedTemplate);

  if (shouldUseHtmlRenderer(invoice, resolvedLanguage)) {
    if (typeof onFallback === "function") return onFallback({ html, reason: "rtl-html-renderer" });
    return { ok: openFallbackWindow(html, format), htmlPrint: true };
  }

  try {
    return await drawEnglishPdf({ format, invoice, filename, template: resolvedTemplate });
  } catch (error) {
    console.warn("PDF generation fallback:", error);
    if (typeof onFallback === "function") return onFallback({ html, error });
    return { ok: false, error, fallbackOpened: openFallbackWindow(html, format) };
  }
};
