import { formatCurrency } from "../lib/currency";
import { DEFAULT_PRODUCT_PLACEHOLDER, resolveInvoiceItemImageUrl } from "../lib/invoiceItemImages";
import { resolveBrandImageUrl } from "../lib/imageUrls";
import {
  documentHasArabicText,
  escapeHtml,
  formatPrintDate,
  getPrintDirection,
  normalizePrintLanguage,
  openPrintHtml,
  wrapPrintableHtml,
} from "./printLocalization";

const GREEN = [5, 150, 105];
const LIGHT_BORDER = [226, 232, 240];
const M1_STORE_NAME = "M1 Store";
const M1_STORE_WEBSITE_TEXT = "Www.m1store-egy.com";
const M1_STORE_WEBSITE_HREF = "https://www.m1store-egy.com";
const M1_STORE_PHONE = "01000659301";
const DEFAULT_SOCIAL_LINKS = {
  googleReviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
  facebookReviewUrl: "https://www.facebook.com/share/1DmN6zj29g/?mibextid=wwXIfr",
  instagramUrl: "https://www.instagram.com/m1store_egy?igsh=MWplb2d4cmJ4YmxhaQ%3D%3D&utm_source=qr",
};
const ARABIC_RETURN_POLICY_HTML = `
  <div>يمكنك الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام وفق الشروط التالية:</div>
  <div>• يجب أن تكون المنتجات غير مستخدمة وبحالتها الأصلية.</div>
  <div>• يجب وجود الفاتورة الأصلية.</div>
  <div>• في حالة وجود عيب مصنعي، تتحمل M1 Store تكلفة الشحن.</div>
  <div>• في حالة الاستبدال بسبب رغبة العميل مثل المقاس أو اللون، يتحمل العميل تكلفة الشحن ذهابًا وعودة.</div>
  <div>للاستفسارات، تواصل مع خدمة العملاء.</div>
`;
const ARABIC_RETURN_POLICY_TEXT = "يمكنك الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام وفق الشروط التالية: يجب أن تكون المنتجات غير مستخدمة وبحالتها الأصلية. يجب وجود الفاتورة الأصلية. في حالة وجود عيب مصنعي، تتحمل M1 Store تكلفة الشحن. في حالة الاستبدال بسبب رغبة العميل مثل المقاس أو اللون، يتحمل العميل تكلفة الشحن ذهابًا وعودة. للاستفسارات، تواصل مع خدمة العملاء.";

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

const getInvoiceSupportPhone = (invoice = {}) =>
  invoice.companyPhone || invoice.storePhone || invoice.supportPhone || invoice.customerServicePhone || M1_STORE_PHONE;

const getInvoiceWebsite = (invoice = {}) =>
  invoice.companyWebsite || invoice.website || invoice.storeWebsite || M1_STORE_WEBSITE_TEXT;

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

const renderStoreLogoMarkup = (invoice = {}) => {
  const logoUrl = getStoreLogoUrl(invoice);
  if (logoUrl) {
    return `
      <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(invoice.store?.name || invoice.companyName || M1_STORE_NAME)}" onerror="this.style.display='none'" style="display:block;width:18mm;height:18mm;object-fit:contain;margin-bottom:4px" />
    `;
  }
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:18mm;height:18mm;margin-bottom:4px;border:1px solid #d1d5db;border-radius:9999px;font-weight:900;font-size:12px;line-height:1">${escapeHtml(M1_STORE_NAME)}</span>`;
};

const getPaymentLabel = (invoice = {}) => {
  const raw = String(invoice.payment?.method || invoice.payment_method || invoice.totals?.payment_method || "").toLowerCase();
  const labels = {
    cash: "نقدًا",
    cod: "الدفع عند الاستلام",
    card: "بطاقة",
    visa: "بطاقة",
    wallet: "محفظة",
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

const getSocialLinks = (invoice = {}) => [
  { key: "google", label: "قيّمنا على Google", url: invoice.google_review_url || invoice.googleReviewUrl || DEFAULT_SOCIAL_LINKS.googleReviewUrl },
  { key: "facebook", label: "قيّمنا على Facebook", url: invoice.facebook_review_url || invoice.facebookReviewUrl || DEFAULT_SOCIAL_LINKS.facebookReviewUrl },
  { key: "instagram", label: "تابعنا على Instagram", url: invoice.instagram_url || invoice.instagramUrl || DEFAULT_SOCIAL_LINKS.instagramUrl },
].filter((link) => link.url && /^https?:\/\//i.test(link.url) && !/localhost|127\.0\.0\.1/i.test(link.url));

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
  const publicUrl = getPublicInvoiceUrl(invoice);
  const social = getSocialLinks(invoice)
    .map((link) => `<a class="pill" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`)
    .join("");
  const rows = items.map((item) => `
    <tr>
      <td>${!thermal ? `<img src="${escapeHtml(item.image || DEFAULT_PRODUCT_PLACEHOLDER)}" alt="" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_PLACEHOLDER}'" style="width:42px;height:42px;object-fit:cover;border-radius:10px;background:#f1f5f9;margin-inline-end:8px;vertical-align:middle" />` : ""}<strong>${escapeHtml(item.name)}</strong><br><small class="muted">${escapeHtml(item.variant)}</small></td>
      ${thermal ? "" : `<td>${escapeHtml(item.variant)}</td>`}
      <td class="number">${escapeHtml(item.quantity)}</td>
      ${thermal ? "" : `<td class="amount">${escapeHtml(formatInvoiceItemMoney(item.price))}</td>`}
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
  const seller = getSellerName(invoice);
  const createdAt = invoice.createdAt || Date.now();
  const body = `
    <main class="print-sheet" dir="${dir}">
      <section class="print-header">
        <div>
          <div class="store-mark">${renderStoreLogoMarkup(invoice)}</div>
          <div class="print-title">فاتورة طلب</div>
          <div class="muted">رقم الطلب: <span class="number">${escapeHtml(invoice.invoiceNumber || "n/a")}</span></div>
          <div class="muted">تاريخ الطلب: ${escapeHtml(formatPrintDate(createdAt, normalized, { dateStyle: "medium", timeStyle: undefined }))}</div>
          <div class="muted">الوقت: ${escapeHtml(formatPrintDate(createdAt, normalized, { dateStyle: undefined, timeStyle: "short" }))}</div>
        </div>
        <div>
          <strong>${escapeHtml(invoice.store?.name || invoice.companyName || M1_STORE_NAME)}</strong><br>
        </div>
      </section>
      <section class="print-card">
        <strong>بيانات العميل</strong><br>
        العميل: ${escapeHtml(invoice.customerName || "عميلنا العزيز")}<br>
        ${invoice.customerPhone ? `رقم الهاتف: <span class="number">${escapeHtml(invoice.customerPhone)}</span><br>` : ""}
        ${seller ? `البائع: ${escapeHtml(seller)}<br>` : ""}
        طريقة الدفع: ${escapeHtml(getPaymentLabel(invoice))}
      </section>
      <table>
        <thead>
          <tr>
            <th>المنتج</th>
            ${thermal ? "" : `<th>اللون / المقاس</th>`}
            <th class="number">الكمية</th>
            ${thermal ? "" : `<th class="amount">السعر</th>`}
            <th class="amount">الإجمالي</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <section class="print-card">
        <div>الإجمالي الفرعي: <span class="amount">${escapeHtml(formatCurrency(invoice.totals?.subtotal || 0))}</span></div>
        ${discount > 0 ? `<div>الخصم: <span class="amount">- ${escapeHtml(formatCurrency(discount))}</span></div>` : ""}
        ${shipping > 0 ? `<div>الشحن: <span class="amount">${escapeHtml(formatCurrency(shipping))}</span></div>` : ""}
        <div>عدد المنتجات: <span class="number">${items.length}</span></div>
        <div>إجمالي الكمية: <span class="number">${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</span></div>
        <div class="total">الإجمالي الكلي: <span class="amount">${escapeHtml(formatCurrency(invoice.totals?.total || 0))}</span></div>
        <div>المدفوع: <span class="amount">${escapeHtml(formatCurrency(paid))}</span></div>
        <div>المتبقي: <span class="amount">${escapeHtml(formatCurrency(remaining))}</span></div>
      </section>
      <section class="print-card policy">${ARABIC_RETURN_POLICY_HTML}</section>
      ${social ? `<section class="print-card" style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">${social}</section>` : ""}
      <footer class="print-footer">
        <div class="barcode">${escapeHtml(invoiceNumber)}</div>
        <div class="green-line"></div>
        <a class="number" href="${escapeHtml(M1_STORE_WEBSITE_HREF)}" target="_blank" rel="noopener noreferrer">${escapeHtml(M1_STORE_WEBSITE_TEXT)}</a> |
        <a class="number" href="tel:${escapeHtml(supportPhone)}">${escapeHtml(supportPhone)} - خدمة العملاء</a>
        ${publicUrl ? "| QR" : ""}
      </footer>
    </main>`;
  return wrapPrintableHtml({ title: invoice.invoiceNumber || "فاتورة طلب", body, language: normalized, thermal });
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
  doc.text(ARABIC_RETURN_POLICY_TEXT, pageWidth / 2, y + 8, {
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
