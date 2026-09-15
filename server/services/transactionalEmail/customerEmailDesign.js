import { escapeHtml, formatCurrency, formatOrderDate, paymentLabel, safeUrl } from "./helpers.js";

// The customer's order email, redesigned 2026-09-15. Email clients ignore most CSS, so this is
// the dull-but-reliable dialect: nested tables, inline styles, 600px, no web fonts (Gmail strips
// them), every colour painted explicitly so a client's dark mode has nothing transparent to flip.
// Blocks that stack on a phone are inline-block cells with a min-width, not media queries.

const C = {
  page: "#f3f1ec",
  card: "#ffffff",
  ink: "#141414",
  body: "#3d3b37",
  muted: "#7a766e",
  line: "#ebe7df",
  soft: "#f8f6f1",
  gold: "#c9a227",
  goldDeep: "#9b7a12",
  goldSoft: "#fbf4dc",
  green: "#1f8a4c",
  greenSoft: "#e8f5ee",
  warn: "#b7791f",
  warnSoft: "#fff6e0",
};
const FONT = "Tahoma, Arial, 'Segoe UI', sans-serif";

const spacer = (height) => `<tr><td height="${height}" style="height:${height}px;line-height:${height}px;font-size:0">&nbsp;</td></tr>`;

const card = (inner, { padding = 24, background = C.card, border = C.line } = {}) =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${background};border:1px solid ${border};border-radius:14px"><tr><td style="padding:${padding}px">${inner}</td></tr></table>`;

const sectionTitle = (title) => `<div style="font:700 15px/1.4 ${FONT};color:${C.ink};margin:0 0 14px">${escapeHtml(title)}</div>`;

export const button = ({ href, label, tone = "gold", fullWidth = false }) => {
  const url = safeUrl(href);
  if (!url) return "";
  const palette = {
    gold: { bg: C.gold, fg: "#1a1405", border: C.gold },
    dark: { bg: C.ink, fg: "#ffffff", border: C.ink },
    light: { bg: "#ffffff", fg: C.ink, border: "#d9d4c8" },
    whatsapp: { bg: "#25d366", fg: "#0b2e17", border: "#25d366" },
  }[tone];
  return `<a href="${escapeHtml(url)}" style="display:${fullWidth ? "block" : "inline-block"};margin:5px 4px;padding:14px 26px;border-radius:10px;background:${palette.bg};border:1px solid ${palette.border};color:${palette.fg};font:700 14px/1 ${FONT};text-decoration:none;text-align:center;mso-padding-alt:0">${escapeHtml(label)}</a>`;
};

/* -------------------------------------------------------------------- hero */

const hero = ({ name, nextStep, number, date }) => `
  <div style="text-align:center">
    <div style="display:inline-block;width:56px;height:56px;border-radius:28px;background:${C.greenSoft};color:${C.green};font:700 28px/56px ${FONT}">&#10003;</div>
    <div style="margin-top:14px;font:700 24px/1.4 ${FONT};color:${C.ink}">شكرًا لطلبك يا ${escapeHtml(name)}</div>
    <div style="margin:8px auto 0;max-width:440px;font:400 14px/1.9 ${FONT};color:${C.body}">${nextStep}</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:18px auto 0"><tr>
      <td style="padding:10px 18px;background:${C.soft};border:1px solid ${C.line};border-radius:999px;font:400 12px/1.4 ${FONT};color:${C.muted}">رقم الطلب <b dir="ltr" style="color:${C.ink};font-size:14px">${escapeHtml(number)}</b> &nbsp;·&nbsp; ${escapeHtml(date)}</td>
    </tr></table>
  </div>`;

/* ----------------------------------------------------------------- tracker */

const STEPS = ["تم استلام الطلب", "تأكيد الطلب", "الشحن", "التسليم"];

export const stepIndexFor = (order = {}) => {
  const status = String(order.status || "").toLowerCase();
  const shipment = String(order.shipment_status || order.shipping_status || "").toLowerCase();
  if (["delivered", "completed"].includes(status) || shipment === "delivered") return 3;
  if (["shipped", "shipment_created", "out_for_delivery", "in_transit"].includes(status) || String(order.shipping_tracking_number || "").trim()) return 2;
  if (["confirmed", "ready_to_ship", "processing", "packed"].includes(status)) return 1;
  return 0;
};

const tracker = (current) => {
  const cells = STEPS.map((label, index) => {
    const done = index < current;
    const active = index === current;
    const dot = done
      ? `<div style="width:26px;height:26px;margin:0 auto;border-radius:13px;background:${C.green};color:#fff;font:700 13px/26px ${FONT}">&#10003;</div>`
      : active
        ? `<div style="width:26px;height:26px;margin:0 auto;border-radius:13px;background:${C.gold};color:#1a1405;font:700 13px/26px ${FONT}">${index + 1}</div>`
        : `<div style="width:24px;height:24px;margin:0 auto;border-radius:12px;background:#ffffff;border:1px solid #d9d4c8;color:${C.muted};font:700 12px/24px ${FONT}">${index + 1}</div>`;
    return `<td width="25%" valign="top" style="text-align:center;padding:0 2px">${dot}<div style="margin-top:8px;font:${active ? "700" : "400"} 11px/1.5 ${FONT};color:${active ? C.ink : C.muted}">${label}</div></td>`;
  }).join("");
  // A plain two-cell progress bar under the steps: overlapping connectors need positioning that
  // Outlook and Gmail do not honour.
  const progress = Math.round(((current + 0.5) / STEPS.length) * 100);
  const bar = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="rtl" style="margin-top:14px"><tr>
    <td width="${progress}%" style="height:4px;background:${C.gold};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
    <td width="${100 - progress}%" style="height:4px;background:${C.line};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
  </tr></table>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="rtl"><tr>${cells}</tr></table>${bar}`;
};

/* ----------------------------------------------------------------- payment */

const moneyRow = (label, value, { strong = false, color = C.body } = {}) =>
  `<tr><td style="padding:5px 0;font:400 13px/1.6 ${FONT};color:${C.muted}">${label}</td><td style="padding:5px 0;text-align:left;font:${strong ? "700 15px" : "400 13px"}/1.6 ${FONT};color:${color};white-space:nowrap">${value}</td></tr>`;

export const paymentCallout = (payment = null) => {
  if (!payment) return "";
  const wrap = (tone, title, inner) => {
    const background = tone === "warn" ? C.warnSoft : tone === "green" ? C.greenSoft : C.soft;
    const border = tone === "warn" ? "#f1d27a" : tone === "green" ? "#bfe3cd" : C.line;
    return card(`<div style="font:700 15px/1.5 ${FONT};color:${C.ink}">${title}</div>${inner}`, { background, border, padding: 20 });
  };
  const table = (rows) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px">${rows}</table>`;
  if (payment.kind === "advance_required") {
    const lines = String(payment.notice || "").split("\n")
      .filter((line) => line && !line.startsWith("📸") && !line.startsWith("💳"))
      .map((line) => `<div style="font:400 13px/1.9 ${FONT};color:${C.body}" dir="auto">${escapeHtml(line)}</div>`)
      .join("");
    return wrap("warn", "مطلوب تحويل رسوم الشحن قبل الشحن",
      `<div style="margin-top:6px;font:400 13px/1.9 ${FONT};color:${C.body}">محافظتك برّه محافظات الدفع عند الاستلام، فبنطلب تحويل رسوم الشحن بس مقدّم والباقي بتدفعه للمندوب.</div>`
      + table(moneyRow("المطلوب تحويله الآن", formatCurrency(payment.advance), { strong: true, color: C.warn }) + moneyRow("الباقي عند الاستلام", formatCurrency(payment.collect)))
      + (lines ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #f1d27a">${lines}</div>` : "")
      + `<div style="margin-top:10px;font:700 13px/1.8 ${FONT};color:${C.ink}">ابعت صورة التحويل على واتساب M1 Store، وهنأكد طلبك ونشحنه على طول.</div>`);
  }
  if (payment.kind === "transfer_review") {
    return wrap("neutral", "استلمنا صورة التحويل وبنراجعها",
      table(moneyRow("المبلغ المحوّل", formatCurrency(payment.transferred), { strong: true }) + (payment.collect > 0 ? moneyRow("الباقي عند الاستلام", formatCurrency(payment.collect)) : "")));
  }
  if (payment.kind === "cod") {
    return wrap("neutral", "الدفع عند الاستلام",
      table((payment.paid > 0 ? moneyRow("المدفوع", formatCurrency(payment.paid)) : "") + moneyRow("هتدفع للمندوب", formatCurrency(payment.collect), { strong: true, color: C.goldDeep })));
  }
  return wrap("green", "طلبك مدفوع بالكامل", `<div style="margin-top:6px;font:400 13px/1.8 ${FONT};color:${C.body}">مفيش أي مبلغ هيتحصّل عند الاستلام.</div>`);
};

/* ---------------------------------------------------------------- products */

const productCard = (item = {}) => {
  const image = safeUrl(item.image_url || "");
  const qty = Math.max(1, Number(item.quantity || 1));
  const unit = Number(item.sale_price || item.price || 0);
  const details = [
    item.color && `اللون: ${escapeHtml(item.color)}`,
    item.size && `المقاس: <span dir="ltr">${escapeHtml(item.size)}</span>`,
    item.article_code && `أرتكل: <span dir="ltr">${escapeHtml(item.article_code)}</span>`,
  ].filter(Boolean).join(" &nbsp;•&nbsp; ");
  return `<tr>
    <td width="84" valign="top" style="padding:14px 0;border-bottom:1px solid ${C.line}">${image
      ? `<img src="${escapeHtml(image)}" width="72" height="72" alt="${escapeHtml(item.product_name || "")}" style="display:block;width:72px;height:72px;border-radius:12px;border:1px solid ${C.line};object-fit:cover;background:${C.soft}">`
      : `<div style="width:72px;height:72px;border-radius:12px;background:${C.soft};border:1px solid ${C.line}"></div>`}</td>
    <td valign="top" style="padding:14px 12px;border-bottom:1px solid ${C.line}">
      <div style="font:700 14px/1.5 ${FONT};color:${C.ink}">${escapeHtml(item.product_name || "منتج")}</div>
      ${details ? `<div style="margin-top:4px;font:400 12px/1.7 ${FONT};color:${C.muted}">${details}</div>` : ""}
      <div style="margin-top:6px;font:400 12px/1.5 ${FONT};color:${C.muted}">الكمية: <b style="color:${C.ink}">${qty}</b> &nbsp;×&nbsp; <span style="white-space:nowrap">${formatCurrency(unit)}</span></div>
      <div style="margin-top:4px;font:700 14px/1.5 ${FONT};color:${C.ink};white-space:nowrap">${formatCurrency(unit * qty)}</div>
    </td>
  </tr>`;
};

const totals = (order = {}) => {
  const shipping = Number(order.delivery_fee ?? order.shipping_fee ?? 0);
  const discount = Number(order.discount_amount || 0);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:6px">
    ${moneyRow("المنتجات", formatCurrency(order.subtotal))}
    ${moneyRow("الشحن", shipping > 0 ? formatCurrency(shipping) : `<span style="color:${C.green};font-weight:700">مجاني</span>`)}
    ${discount > 0 ? moneyRow(order.coupon_code ? `الخصم (<span dir="ltr">${escapeHtml(order.coupon_code)}</span>)` : "الخصم", `<span style="color:${C.green}">-${formatCurrency(discount)}</span>`) : ""}
    <tr><td colspan="2" style="padding:8px 0 0"><div style="height:1px;background:${C.line};font-size:0;line-height:0">&nbsp;</div></td></tr>
    <tr><td style="padding:12px 0 2px;font:700 16px/1.4 ${FONT};color:${C.ink}">الإجمالي</td><td style="padding:12px 0 2px;text-align:left;font:700 20px/1.4 ${FONT};color:${C.goldDeep};white-space:nowrap">${formatCurrency(order.total_amount || order.total)}</td></tr>
    <tr><td colspan="2" style="padding:2px 0 0;font:400 12px/1.6 ${FONT};color:${C.muted}">طريقة الدفع: ${escapeHtml(paymentLabel(order.payment_method))}</td></tr>
  </table>`;
};

/* -------------------------------------------------------------- info cells */

const infoBlock = (title, lines = []) => `<div style="display:inline-block;width:100%;max-width:262px;min-width:220px;vertical-align:top;margin:0 6px 12px;text-align:right" dir="rtl">
  ${card(`<div style="font:700 13px/1.4 ${FONT};color:${C.ink};margin-bottom:8px">${escapeHtml(title)}</div>${lines.filter(Boolean).map((line) => `<div style="font:400 13px/1.8 ${FONT};color:${C.body}">${line}</div>`).join("")}`, { padding: 16 })}
</div>`;

/* ------------------------------------------------------------------ render */

export const renderCustomerOrderEmailBody = ({ order = {}, items = [], links = {}, brand = {}, payment = null, nextStep = "" } = {}) => {
  const number = order.public_order_number || order.invoice_number || order.id;
  const current = stepIndexFor(order);
  const address = [order.shipping_address_line || order.customer_address, [order.city_area, order.governorate].filter(Boolean).join("، ")]
    .filter(Boolean).map((line) => escapeHtml(line));
  const contact = [
    escapeHtml(order.customer_name),
    order.customer_phone && `<span dir="ltr">${escapeHtml(order.customer_phone)}</span>`,
    order.customer_secondary_phone && `<span dir="ltr">${escapeHtml(order.customer_secondary_phone)}</span>`,
    order.customer_email && `<span dir="ltr">${escapeHtml(order.customer_email)}</span>`,
  ];
  const help = safeUrl(brand.whatsappUrl) || brand.phone
    // Stacked and centred: a side-by-side button squeezes the text into one word per line on a phone.
    ? card(`<div style="text-align:center"><div style="font:700 15px/1.5 ${FONT};color:${C.ink}">محتاج مساعدة في طلبك؟</div><div style="margin-top:4px;font:400 13px/1.8 ${FONT};color:${C.muted}">فريقنا موجود على واتساب يرد على أي سؤال.${brand.phone ? ` أو كلّمنا على <span dir="ltr" style="white-space:nowrap">${escapeHtml(brand.phone)}</span>` : ""}</div><div style="margin-top:10px">${button({ href: brand.whatsappUrl, label: "كلّمنا على واتساب", tone: "whatsapp" })}</div></div>`, { background: C.soft, padding: 20 })
    : "";

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr><td>${hero({ name: order.customer_name || "عميلنا العزيز", nextStep, number, date: formatOrderDate(order.created_at) })}</td></tr>
    ${spacer(26)}
    <tr><td>${card(tracker(current), { padding: 18 })}</td></tr>
    ${payment ? `${spacer(16)}<tr><td>${paymentCallout(payment)}</td></tr>` : ""}
    ${spacer(16)}
    <tr><td>${card(`${sectionTitle(`منتجاتك (${items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0)})`)}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${items.map(productCard).join("")}</table>${totals(order)}`)}</td></tr>
    ${spacer(16)}
    <tr><td style="text-align:center;font-size:0">${infoBlock("عنوان التوصيل", address)}${infoBlock("بيانات التواصل", contact)}</td></tr>
    ${spacer(12)}
    <tr><td style="text-align:center">${button({ href: links.track, label: "تتبع الطلب", tone: "gold" })}${button({ href: links.invoice, label: "عرض الفاتورة", tone: "light" })}</td></tr>
    ${help ? `${spacer(22)}<tr><td>${help}</td></tr>` : ""}
  </table>`;
};

// One mark, centred, on the brand black. The logo already carries "STORE · CHANGE YOUR LIFE", so the
// old header's wordmark, tagline, rule and "EST. 2021 / DAMIETTA" said everything twice (owner, 2026-09-15).
export const customerEmailHeader = ({ logoUrl = "" } = {}) => {
  const logo = safeUrl(logoUrl)
    ? `<img src="${escapeHtml(logoUrl)}" width="84" height="84" alt="M1 Store" style="display:block;margin:0 auto;width:84px;height:84px;border-radius:42px;border:0;background:#101010">`
    : `<div style="font:700 22px/1.2 ${FONT};color:#e9c55a;letter-spacing:6px">M1 STORE</div>`;
  return `<tr><td bgcolor="#101010" align="center" style="padding:30px 24px 26px;background:#101010;background-image:linear-gradient(#101010,#101010);text-align:center">${logo}</td></tr>
  <tr><td height="3" bgcolor="${C.gold}" style="height:3px;line-height:3px;font-size:0;background:${C.gold}">&nbsp;</td></tr>`;
};

// Quiet, like the header: text links on one line, the support address on its own line, the legal
// note small. Every Latin run (the store name, the address, the year) sits in its own ltr span —
// dropped bare into an Arabic sentence it reorders the sentence around it (owner screenshot, 2026-09-15).
// Icons are PNGs served by the storefront (public/email-icons, 96px drawn at 36px): Gmail and
// Outlook drop inline SVG, and an icon font never loads in an email.
const SOCIAL_ICONS = new Set(["facebook", "instagram", "whatsapp", "tiktok"]);

export const customerEmailFooter = ({ supportEmail = "support@m1store-egy.com", socialLinks = [], whatsappUrl = "", iconBaseUrl = "" } = {}) => {
  const items = [
    ...socialLinks.filter((item) => safeUrl(item?.url)),
    ...(safeUrl(whatsappUrl) ? [{ label: "WhatsApp", url: whatsappUrl }] : []),
  ];
  const iconBase = safeUrl(iconBaseUrl).replace(/\/+$/, "");
  const links = items
    .map((item) => {
      const key = String(item.label || "").toLowerCase();
      const icon = iconBase && SOCIAL_ICONS.has(key)
        ? `<img src="${escapeHtml(`${iconBase}/email-icons/${key}.png`)}" width="36" height="36" alt="${escapeHtml(item.label)}" style="display:block;width:36px;height:36px;border:0">`
        : `<span style="color:#e9c55a;font:700 13px/36px ${FONT}">${escapeHtml(item.label)}</span>`;
      return `<a href="${escapeHtml(item.url)}" style="display:inline-block;margin:0 7px;text-decoration:none;vertical-align:middle">${icon}</a>`;
    })
    .join("");
  const year = new Date().getFullYear();
  return `<tr><td bgcolor="#101010" style="padding:30px 32px 28px;background:#101010;text-align:center" dir="rtl">
    ${links ? `<div style="line-height:1">${links}</div>` : ""}
    <div style="margin:${links ? "20px" : "0"} auto 0;width:40px;height:1px;background:#3a3222;font-size:0;line-height:0">&nbsp;</div>
    <div style="margin-top:18px;font:400 12px/1.6 ${FONT};color:#9f9b92">عندك سؤال؟ ابعتلنا على</div>
    <div style="margin-top:2px"><a href="mailto:${escapeHtml(supportEmail)}" dir="ltr" style="color:#e9c55a;font:400 13px/1.6 ${FONT};text-decoration:none">${escapeHtml(supportEmail)}</a></div>
    <div style="margin-top:18px;font:400 11px/1.9 ${FONT};color:#6f6c65">وصلتك الرسالة دي لأنك عملت طلب من متجرنا، ومش هنطلب منك أي بيانات دفع بالإيميل.</div>
    <div style="margin-top:6px;font:400 11px/1.6 ${FONT};color:#55524c" dir="ltr">© ${year} M1 Store</div>
  </td></tr>`;
};
