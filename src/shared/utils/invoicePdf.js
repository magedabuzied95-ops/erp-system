import { APP_NAME } from "../constants/app";
import { formatCurrency } from "../lib/currency";
import { resolveProductImageUrl } from "../lib/imageUrls";

const safeWindow = () => (typeof window !== "undefined" ? window : null);
const loggedInvoiceImageItems = new WeakSet();

const RETURN_POLICY_TEXT = "يسمح بالاستبدال والاسترجاع خلال 14 يوم بشرط عدم الاستخدام والحفاظ على الفاتورة";
const GREEN = [5, 150, 105];
const LIGHT_BORDER = [226, 232, 240];
const DEFAULT_SOCIAL_LINKS = {
  googleReviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
  facebookReviewUrl: "https://www.facebook.com/MONESHOESSTORE/reviews",
  instagramUrl: "https://www.instagram.com/m1store_eg/",
};

const formatArabicDate = (value = new Date()) =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));

const formatArabicTime = (value = new Date()) =>
  new Intl.DateTimeFormat("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

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

const unwrapInvoiceImageValue = (value) => {
  if (!value) return "";
  if (typeof value === "object") return value.url || value.path || value.image_url || value.secure_url || "";
  return value;
};

const getInvoiceItemImage = (item = {}) => {
  if (import.meta.env.DEV && item && typeof item === "object" && !loggedInvoiceImageItems.has(item)) {
    loggedInvoiceImageItems.add(item);
    console.log("[invoice item image debug]", item);
  }

  const candidates = [
    item.image_url,
    item.image,
    item.product_image,
    item.cover_image,
    item.thumbnail,
    item.variant_image,
    item.variant_image_url,
    item.product?.image_url,
    item.product?.image,
    item.product?.cover_image,
    item.product?.thumbnail,
    item.variant?.image_url,
    item.variant?.image,
    item.variant?.image_path,
    item.product_variant?.image_url,
    item.product_variant?.image,
    item.color?.image_url,
    item.color_image_url,
    item.images?.[0],
    item.gallery?.[0],
    item.product?.gallery?.[0],
    item.product?.images?.[0],
  ];

  return candidates.map(unwrapInvoiceImageValue).find(Boolean) || "";
};

const formatInvoiceItemMoney = (value) => (Number(value || 0) > 0 ? formatCurrency(value) : "غير محدد");

const getInvoiceSupportPhone = (invoice = {}) =>
  invoice.companyPhone || invoice.storePhone || invoice.supportPhone || invoice.customerServicePhone || "01234567890";

const getInvoiceWebsite = (invoice = {}) =>
  invoice.companyWebsite || invoice.website || invoice.storeWebsite || "www.workspace.com";

const getPublicAppUrl = () => {
  const env = import.meta.env || {};
  const selected = [env.VITE_PUBLIC_APP_URL, env.PUBLIC_APP_URL, env.FRONTEND_URL]
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
    cash: "نقدًا",
    card: "فيزا",
    visa: "فيزا",
    wallet: "محفظة",
    split: "متعدد",
    transfer: "تحويل",
    bank_transfer: "تحويل",
  };
  return labels[raw] || (raw ? raw : "نقدًا");
};

const getSellerName = (invoice = {}) => {
  const seller = invoice.salesman_name || invoice.sales_name || invoice.seller_name || invoice.sellerName || invoice.salesName;
  if (!seller || /cashieradmin/i.test(String(seller))) return "";
  return seller;
};

const getSocialLinks = (invoice = {}) => [
  { key: "google", label: "قيّمنا على جوجل", url: invoice.google_review_url || invoice.googleReviewUrl || DEFAULT_SOCIAL_LINKS.googleReviewUrl },
  { key: "facebook", label: "قيّمنا على فيسبوك", url: invoice.facebook_review_url || invoice.facebookReviewUrl || DEFAULT_SOCIAL_LINKS.facebookReviewUrl },
  { key: "instagram", label: "تابعنا على إنستجرام", url: invoice.instagram_url || invoice.instagramUrl || DEFAULT_SOCIAL_LINKS.instagramUrl },
].filter((link) => link.url && /^https?:\/\//i.test(link.url) && !/localhost|127\.0\.0\.1/i.test(link.url));

const normalizeItems = (items = [], format = "a4") =>
  items.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const price = resolveItemPrice(item);
    const discount = Number(item.discount_amount ?? item.lineDiscount ?? 0);
    const variant = [item.size, item.color].filter(Boolean).join(" / ") || "غير محدد";
    const name = item.product_name || item.name || `منتج ${index + 1}`;
    return {
      name,
      variant,
      quantity,
      price,
      discount,
      image: resolveProductImageUrl(getInvoiceItemImage(item)),
      total: Number(item.total_amount || item.total || Math.max(0, price * quantity - discount)),
      label: format === "thermal" ? `${name}\n${variant}` : name,
    };
  });

const drawHeader = (doc, invoice, format) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const isThermal = format === "thermal";
  const margin = isThermal ? 4 : 12;
  const logoSize = isThermal ? 12 : 18;
  const now = new Date(invoice.createdAt || Date.now());
  const dateText = formatArabicDate(now);
  const timeText = formatArabicTime(now);

  doc.setDrawColor(...LIGHT_BORDER);
  doc.roundedRect(pageWidth - margin - logoSize, margin, logoSize, logoSize, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 7 : 10);
  doc.setTextColor(...GREEN);
  doc.text("LOGO", pageWidth - margin - logoSize / 2, margin + logoSize / 2 + 1.5, { align: "center" });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(isThermal ? 10 : 16);
  doc.text(invoice.companyName || APP_NAME, pageWidth - margin - logoSize - 3, margin + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(isThermal ? 6.5 : 8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(invoice.companyTagline || "Premium Shoes", pageWidth - margin - logoSize - 3, margin + 10, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 11 : 18);
  doc.setTextColor(...GREEN);
  doc.text("فاتورة بيع", margin, margin + 5, { align: "left" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(isThermal ? 6.4 : 8);
  doc.setTextColor(71, 85, 105);
  doc.text(`رقم الفاتورة: ${invoice.invoiceNumber || "n/a"}`, margin, margin + 10, { align: "left" });
  doc.text(`التاريخ: ${dateText}`, margin, margin + 14, { align: "left" });
  doc.text(`الوقت: ${timeText}`, margin, margin + 18, { align: "left" });

  const lineY = margin + logoSize + 5;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.35);
  doc.line(margin, lineY, pageWidth - margin, lineY);
  return lineY + 4;
};

const drawCustomerBlock = (doc, invoice, y, format) => {
  const isThermal = format === "thermal";
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = isThermal ? 4 : 12;
  const boxWidth = isThermal ? pageWidth - margin * 2 : Math.min(92, pageWidth - margin * 2);
  const x = pageWidth - margin - boxWidth;
  const seller = getSellerName(invoice);
  const rows = [
    `العميل: ${invoice.customerName || "عميل نقدي"}`,
    invoice.customerPhone ? `الهاتف: ${invoice.customerPhone}` : null,
    seller ? `البائع: ${seller}` : null,
    "----------------",
    `طريقة الدفع: ${getPaymentLabel(invoice)}`,
  ].filter(Boolean);
  const rowGap = isThermal ? 3.8 : 4.4;
  const height = Math.max(isThermal ? 18 : 23, 6 + rows.length * rowGap);

  doc.setDrawColor(...LIGHT_BORDER);
  doc.roundedRect(x, y, boxWidth, height, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 7.5 : 10);
  doc.setTextColor(15, 23, 42);
  doc.text("بيانات العميل", x + boxWidth - 3, y + 6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(isThermal ? 6.5 : 8.5);
  rows.forEach((line, index) => {
    const rowY = y + 9.5 + index * rowGap;
    if (line === "----------------") {
      doc.setDrawColor(203, 213, 225);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(x + 3, rowY, x + boxWidth - 3, rowY);
      doc.setLineDashPattern([], 0);
      return;
    }
    doc.text(line, x + boxWidth - 3, rowY, { align: "right", maxWidth: boxWidth - 6 });
  });
  return y + height + 4;
};

const drawSummary = (doc, invoice, y, format) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const isThermal = format === "thermal";
  const margin = isThermal ? 4 : 12;
  const width = pageWidth - margin * 2;
  const items = normalizeItems(invoice.items || [], format);
  const discount =
    Number(invoice.totals?.discount || 0) +
    Number(invoice.totals?.itemDiscountTotal || 0) +
    Number(invoice.totals?.invoiceDiscount || 0) +
    Number(invoice.totals?.loyaltyDiscount || 0);
  const service = Number(invoice.totals?.service || invoice.totals?.serviceFee || 0);
  const walletPaid = Number(invoice.payment?.walletAmount || invoice.walletAmount || invoice.totals?.walletAmount || 0);
  const remainingCashOrCard = Number(invoice.payment?.remainingCashOrCard || invoice.remainingCashOrCard || 0);
  const walletBalanceAfter = Number(invoice.payment?.walletBalanceAfter ?? invoice.walletBalanceAfter ?? 0);
  const rows = [
    ["المجموع الفرعي", formatCurrency(invoice.totals?.subtotal || 0)],
    ...(discount > 0 ? [["الخصم", `- ${formatCurrency(discount)}`]] : []),
    ...(service > 0 ? [["الخدمة", formatCurrency(service)]] : []),
  ];
  if (walletPaid > 0) {
    rows.push(["المدفوع من المحفظة", formatCurrency(walletPaid)]);
    rows.push(["المتبقي نقدي/بطاقة", formatCurrency(remainingCashOrCard)]);
    rows.push(["رصيد المحفظة بعد العملية", formatCurrency(walletBalanceAfter)]);
  }
  const height = isThermal ? 28 + rows.length * 4 : 34 + rows.length * 4;
  if (y + height + (isThermal ? 45 : 60) > pageHeight) {
    doc.addPage();
    y = margin;
  }

  doc.setDrawColor(...LIGHT_BORDER);
  doc.roundedRect(margin, y, width, height, 2, 2, "S");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(isThermal ? 6.5 : 8.5);
  doc.setTextColor(71, 85, 105);
  rows.forEach(([label, value], index) => {
    const rowY = y + 7 + index * (isThermal ? 4.5 : 5.2);
    doc.text(label, pageWidth - margin - 3, rowY, { align: "right" });
    doc.text(value, margin + 3, rowY, { align: "left" });
  });
  doc.text(`عدد المنتجات: ${items.length}`, pageWidth - margin - 3, y + height - 12, { align: "right" });
  doc.text(`إجمالي الكمية: ${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}`, pageWidth - margin - 45, y + height - 12, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 8.5 : 12);
  doc.setTextColor(...GREEN);
  doc.text("الإجمالي النهائي", pageWidth - margin - 3, y + height - 6, { align: "right" });
  doc.text(formatCurrency(invoice.totals?.total || 0), margin + 3, y + height - 6, { align: "left" });
  return y + height + 4;
};

const drawFooter = (doc, invoice, y, format) => {
  const isThermal = format === "thermal";
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = isThermal ? 4 : 12;
  const width = pageWidth - margin * 2;
  const publicUrl = getPublicInvoiceUrl(invoice);
  const socialLinks = getSocialLinks(invoice);
  const barcodeHeight = isThermal ? 6 : 8;
  const footerY = Math.max(y, pageHeight - (isThermal ? 46 : 56));

  doc.setDrawColor(...LIGHT_BORDER);
  doc.roundedRect(margin, footerY, width, isThermal ? 40 : 48, 2, 2, "S");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(isThermal ? 5.7 : 7);
  doc.setTextColor(71, 85, 105);
  doc.text(RETURN_POLICY_TEXT, pageWidth / 2, footerY + 5, { align: "center", maxWidth: width - 8 });
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.25);
  doc.line(margin + 3, footerY + 8, pageWidth - margin - 3, footerY + 8);

  let socialY = footerY + 12;
  if (socialLinks.length) {
    const pillWidth = Math.min(46, (width - 8) / socialLinks.length);
    socialLinks.forEach((link, index) => {
      const x = pageWidth - margin - 3 - (index + 1) * pillWidth;
      const color = link.key === "facebook" ? [24, 119, 242] : link.key === "instagram" ? [225, 48, 108] : [203, 213, 225];
      const textColor = link.key === "facebook" ? [29, 78, 216] : link.key === "instagram" ? [190, 24, 93] : [51, 65, 85];
      doc.setDrawColor(...color);
      doc.roundedRect(x, socialY - 4, pillWidth - 2, 6.5, 3.2, 3.2, "S");
      doc.setFontSize(isThermal ? 5 : 6);
      doc.setTextColor(...textColor);
      doc.setFont("helvetica", "bold");
      const brand = link.key === "google" ? "G" : link.key === "facebook" ? "f" : "◎";
      doc.text(brand, x + pillWidth - 5, socialY, { align: "center" });
      doc.textWithLink(link.label, x + (pillWidth - 2) / 2, socialY, { align: "center", url: link.url });
    });
    doc.setTextColor(71, 85, 105);
    socialY += 6.5;
  }

  const barcodeX = margin + 6;
  const barcodeY = socialY;
  const barcodeWidth = width - 12;
  doc.setDrawColor(15, 23, 42);
  doc.rect(barcodeX, barcodeY, barcodeWidth, barcodeHeight);
  let cursor = barcodeX + 2;
  String(invoice.barcodeValue || invoice.invoiceNumber || "000000")
    .split("")
    .forEach((char, index) => {
      const seed = char.charCodeAt(0) + index * 13;
      const barWidth = 0.5 + (seed % 4) * 0.35;
      const barHeight = barcodeHeight - 2 - (seed % 5) * 0.4;
      doc.setFillColor(15, 23, 42);
      doc.rect(cursor, barcodeY + 1, barWidth, barHeight, "F");
      cursor += barWidth + 0.5;
    });

  const invoiceNumber = String(invoice.barcodeValue || invoice.invoiceNumber || "000000");
  const numberY = barcodeY + barcodeHeight + 1.2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 5 : 5.8);
  doc.text(invoiceNumber, barcodeX + barcodeWidth / 2, numberY, { align: "center" });

  const lineY = numberY + 1.3;
  doc.setDrawColor(...GREEN);
  doc.line(margin + 3, lineY, pageWidth - margin - 3, lineY);
  const contactY = lineY + (isThermal ? 3 : 3.6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(isThermal ? 5.2 : 6.2);
  doc.setTextColor(71, 85, 105);
  doc.text(getInvoiceWebsite(invoice), pageWidth / 2 - 4, contactY, { align: "right" });
  doc.text("|", pageWidth / 2, contactY, { align: "center" });
  doc.text(`خدمة العملاء - ${getInvoiceSupportPhone(invoice)}`, pageWidth / 2 + 4, contactY, { align: "left" });
  if (publicUrl) {
    const qrSize = isThermal ? 7 : 9;
    const qrX = margin + 4;
    const qrY = contactY - qrSize + 1;
    doc.rect(qrX, qrY, qrSize, qrSize);
    doc.setFontSize(isThermal ? 4.2 : 5);
    doc.text("QR", qrX + qrSize / 2, qrY + qrSize / 2 + 1, { align: "center" });
    doc.link(qrX, qrY, qrSize, qrSize, { url: publicUrl });
  }
};

const buildFallbackHtml = (invoice, format) => {
  const invoiceNumber = invoice.barcodeValue || invoice.invoiceNumber || "000000";
  const supportPhone = getInvoiceSupportPhone(invoice);
  const website = getInvoiceWebsite(invoice);
  const rows = normalizeItems(invoice.items, format)
    .map(
      (item) => `
        <tr>
          <td>${item.image ? `<img src="${item.image}" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:10px;background:#f1f5f9;margin-left:8px;vertical-align:middle" />` : ""}<strong>${item.name}</strong><br><small>${item.variant}</small></td>
          <td>${item.variant}</td>
          <td>${item.quantity}</td>
          <td>${formatInvoiceItemMoney(item.price)}</td>
          <td>${formatCurrency(item.total)}</td>
        </tr>
      `
    )
    .join("");
  const social = getSocialLinks(invoice)
    .map((link) => `<a class="pill" href="${link.url}" target="_blank" rel="noopener noreferrer">★ ${link.label}</a>`)
    .join("");

  return `
    <html dir="rtl" lang="ar">
      <head>
        <title>${invoice.invoiceNumber || "فاتورة بيع"}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 18px; background: #f4f4f5; color: #111827; }
          .sheet { max-width: 780px; margin: 0 auto; background: #fff; padding: 18px; border: 1px solid #e5e7eb; border-radius: 18px; }
          .header { display:flex; justify-content:space-between; gap:18px; border-bottom:1px solid #059669; padding-bottom:10px; }
          .brand { display:flex; gap:10px; align-items:flex-start; }
          .logo { width:52px; height:52px; border:1px solid #e5e7eb; border-radius:12px; display:flex; align-items:center; justify-content:center; color:#059669; font-weight:800; }
          .title { color:#047857; font-size:26px; font-weight:900; }
          .card { border:1px solid #e5e7eb; border-radius:12px; padding:10px; margin-top:10px; }
          table { width:100%; border-collapse: collapse; margin-top: 10px; direction:rtl; }
          th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; font-size: 12px; text-align:right; }
          th { background: #f8fafc; color:#475569; }
          .summary { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
          .total { color:#047857; font-weight:900; font-size:18px; }
          .policy { text-align:center; font-size:11px; font-weight:700; }
          .green-line { height:1px; background:#059669; margin:6px 0; }
          .pills { display:flex; gap:6px; justify-content:center; margin-top:8px; }
          .pill { border:1px solid #e5e7eb; border-radius:999px; padding:5px 10px; color:#334155; text-decoration:none; font-size:11px; font-weight:700; }
          .footer { text-align:center; font-size:10px; font-weight:700; color:#475569; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="header">
            <div class="brand"><div class="logo">LOGO</div><div><h2>${invoice.companyName || APP_NAME}</h2><div>${invoice.companyTagline || "Premium Shoes"}</div></div></div>
            <div><div class="title">فاتورة بيع</div><div>رقم الفاتورة: ${invoice.invoiceNumber || "n/a"}</div><div>${invoice.createdAt || ""}</div></div>
          </div>
          <div class="card">
            <strong>${invoice.customerName || "عميل نقدي"}</strong><br>
            ${invoice.customerPhone ? `${invoice.customerPhone}<br>` : ""}
            ${getSellerName(invoice) ? `البائع: ${getSellerName(invoice)}<br>` : ""}
            <hr>
            طريقة الدفع: ${getPaymentLabel(invoice)}
          </div>
          <table><thead><tr><th>المنتج</th><th>المقاس / اللون</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="card summary">
            <div>المجموع الفرعي: ${formatCurrency(invoice.totals?.subtotal || 0)}<br><span class="total">الإجمالي النهائي: ${formatCurrency(invoice.totals?.total || 0)}</span></div>
            <div>عدد المنتجات: ${normalizeItems(invoice.items || [], format).length}<br>إجمالي الكمية: ${normalizeItems(invoice.items || [], format).reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</div>
          </div>
          <div class="card policy">✓ ${RETURN_POLICY_TEXT}</div>
          <div class="green-line"></div>
          <div class="pills">${social}</div>
          <div class="footer">
            <div style="margin-top:6px;font-weight:900">${invoiceNumber}</div>
            <div class="green-line"></div>
            ${website} | خدمة العملاء - ${supportPhone} &nbsp; QR
          </div>
        </div>
      </body>
    </html>
  `;
};

const openFallbackWindow = (html) => {
  const win = safeWindow();
  if (!win) return false;
  const popup = win.open("", "_blank", "width=980,height=1200");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
  popup.close();
  return true;
};

export const downloadInvoicePdf = async ({
  format = "a4",
  invoice = {},
  filename,
  onFallback,
} = {}) => {
  try {
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

    doc.setProperties({
      title: invoice.invoiceNumber || "فاتورة بيع",
      subject: "فاتورة بيع",
      author: invoice.companyName || APP_NAME,
    });

    let y = drawHeader(doc, invoice, format);
    y = drawCustomerBlock(doc, invoice, y, format);

    const items = normalizeItems(invoice.items || [], format);
    const head = isThermal
      ? [["المنتج", "الكمية", "الإجمالي"]]
      : [["المنتج", "المقاس / اللون", "الكمية", "السعر", "الإجمالي"]];
    const body = isThermal
      ? items.map((item) => [item.label, String(item.quantity), formatCurrency(item.total)])
      : items.map((item) => [
          item.name,
          item.variant,
          String(item.quantity),
          formatInvoiceItemMoney(item.price),
          formatCurrency(item.total),
        ]);

    autoTable(doc, {
      startY: y,
      head,
      body,
      theme: "plain",
      margin: { left: isThermal ? 4 : 12, right: isThermal ? 4 : 12, top: 0, bottom: 8 },
      styles: {
        font: "helvetica",
        fontSize: isThermal ? 6.2 : 8,
        cellPadding: isThermal ? 1.1 : 1.8,
        valign: "middle",
        halign: "right",
        lineColor: LIGHT_BORDER,
        lineWidth: 0.15,
      },
      headStyles: {
        fillColor: [248, 250, 252],
        textColor: [71, 85, 105],
        fontStyle: "bold",
        halign: "right",
      },
      columnStyles: isThermal
        ? {
            0: { cellWidth: 42 },
            1: { halign: "center", cellWidth: 10 },
            2: { halign: "left", cellWidth: 20, textColor: GREEN, fontStyle: "bold" },
          }
        : {
            0: { cellWidth: 68 },
            1: { cellWidth: 40 },
            2: { halign: "center", cellWidth: 18 },
            3: { halign: "left", cellWidth: 30 },
            4: { halign: "left", cellWidth: 30, textColor: GREEN, fontStyle: "bold" },
          },
    });

    const afterTable = (doc.lastAutoTable && doc.lastAutoTable.finalY) || y;
    const summaryY = drawSummary(doc, invoice, afterTable + 4, format);
    drawFooter(doc, invoice, summaryY + 2, format);

    doc.save(filename || `${invoice.invoiceNumber || "invoice"}.pdf`);
    return { ok: true };
  } catch (error) {
    console.warn("PDF generation fallback:", error);
    const html = buildFallbackHtml(invoice, format);
    if (typeof onFallback === "function") return onFallback({ html, error });
    return { ok: false, error, fallbackOpened: openFallbackWindow(html) };
  }
};
