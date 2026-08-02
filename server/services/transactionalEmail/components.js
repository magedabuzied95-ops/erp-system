import { escapeHtml, formatCurrency, safeUrl } from "./helpers.js";

const BRAND = { gold: "#d0a632", ink: "#101010", paper: "#f5f3ef", muted: "#6b6861" };

export const emailButton = ({ href, label, secondary = false }) => {
  const safeHref = safeUrl(href);
  if (!safeHref) return "";
  return `<a href="${escapeHtml(safeHref)}" style="display:inline-block;margin:6px 4px;padding:13px 22px;border-radius:10px;background:${secondary ? "#ffffff" : BRAND.gold};color:${secondary ? BRAND.ink : "#171205"};border:1px solid ${secondary ? "#d7d2c7" : BRAND.gold};font:700 14px Arial,sans-serif;text-decoration:none">${escapeHtml(label)}</a>`;
};

export const emailHeader = ({ logoUrl = "", eyebrow = "M1 STORE" } = {}) => `<tr><td bgcolor="#101010" style="padding:20px 26px;background:#101010;background-image:linear-gradient(#101010,#101010);border-bottom:3px solid ${BRAND.gold}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="ltr"><tr>
    <td width="68" style="width:68px;vertical-align:middle">
      ${safeUrl(logoUrl) ? `<div style="width:58px;height:58px;border-radius:16px;background:#ffffff;border:1px solid #343434;overflow:hidden"><img src="${escapeHtml(logoUrl)}" width="58" height="58" alt="M1 Store" style="display:block;width:58px;height:58px;object-fit:contain;border:0"></div>` : `<div style="width:58px;height:58px;border-radius:16px;background:${BRAND.gold};color:#101010;text-align:center;font:800 17px/58px Arial,sans-serif">M1</div>`}
    </td>
    <td style="padding-left:14px;vertical-align:middle;text-align:left">
      <div style="color:#f0c94f!important;-webkit-text-fill-color:#f0c94f;font:900 22px/1.2 Arial,sans-serif;letter-spacing:2.5px;text-shadow:0 0 1px #f0c94f">${escapeHtml(eyebrow)}</div>
      <div style="margin-top:6px;color:#e2b83c!important;-webkit-text-fill-color:#e2b83c;font:800 10px/1.2 Arial,sans-serif;letter-spacing:2.2px">CHANGE YOUR LIFE</div>
      <div style="margin-top:7px;width:34px;height:2px;background:${BRAND.gold};font-size:0;line-height:0">&nbsp;</div>
    </td>
    <td style="vertical-align:middle;text-align:right;color:#f0c94f!important;-webkit-text-fill-color:#f0c94f;font:800 11px/1.55 Arial,sans-serif;letter-spacing:1px">EST. 2024<br>CAIRO</td>
  </tr></table>
</td></tr>`;

export const emailFooter = ({ supportEmail = "support@m1store-egy.com", socialLinks = [] } = {}) => {
  const social = socialLinks.filter((item) => safeUrl(item?.url)).map((item) => `<a href="${escapeHtml(item.url)}" style="color:#d0a632;text-decoration:none;margin:0 7px">${escapeHtml(item.label)}</a>`).join("");
  return `<tr><td style="padding:28px 32px;background:#101010;text-align:center;color:#a9a69f;font:12px/1.8 Arial,sans-serif">
    <div style="color:#ffffff;font-weight:700">M1 Store</div>
    <div>للدعم: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#d0a632;text-decoration:none">${escapeHtml(supportEmail)}</a></div>
    ${social ? `<div style="margin-top:8px">${social}</div>` : ""}
    <div style="margin-top:12px">هذه رسالة آلية خاصة بطلبك، لا تتضمن أي بيانات دفع حساسة.</div>
  </td></tr>`;
};

export const productRows = (items = []) => items.map((item) => {
  const image = safeUrl(item.image_url || "");
  const qty = Math.max(1, Number(item.quantity || 1));
  const unit = Number(item.sale_price || item.price || 0);
  return `<tr>
    <td style="padding:14px 0;border-bottom:1px solid #ece8df;width:70px">${image ? `<img src="${escapeHtml(image)}" width="58" height="58" alt="" style="display:block;width:58px;height:58px;border-radius:10px;object-fit:cover;background:#fff">` : ""}</td>
    <td style="padding:14px 10px;border-bottom:1px solid #ece8df;font:13px/1.6 Arial,sans-serif;color:#171717"><strong>${escapeHtml(item.product_name || "منتج")}</strong><br><span style="color:#6b6861">اللون: ${escapeHtml(item.color || "-")} &nbsp; المقاس: ${escapeHtml(item.size || "-")}</span></td>
    <td style="padding:14px 4px;border-bottom:1px solid #ece8df;text-align:center;font:13px Arial,sans-serif">${qty}</td>
    <td style="padding:14px 4px;border-bottom:1px solid #ece8df;text-align:left;font:12px Arial,sans-serif;white-space:nowrap">${formatCurrency(unit)}</td>
    <td style="padding:14px 0;border-bottom:1px solid #ece8df;text-align:left;font:700 13px Arial,sans-serif;white-space:nowrap">${formatCurrency(unit * qty)}</td>
  </tr>`;
}).join("");

export const orderSummary = (order = {}) => {
  const rows = [
    ["الإجمالي الفرعي", order.subtotal],
    ["الشحن", order.delivery_fee ?? order.shipping_fee],
    ["الخصم", Number(order.discount_amount || 0) ? `-${formatCurrency(order.discount_amount)}` : formatCurrency(0)],
  ];
  return `${rows.map(([label, value]) => `<tr><td style="padding:6px 0;color:#6b6861;font:13px Arial,sans-serif">${label}</td><td style="padding:6px 0;text-align:left;font:13px Arial,sans-serif">${typeof value === "string" ? value : formatCurrency(value)}</td></tr>`).join("")}
  <tr><td style="padding:12px 0 4px;border-top:2px solid #171717;font:700 16px Arial,sans-serif">الإجمالي</td><td style="padding:12px 0 4px;border-top:2px solid #171717;text-align:left;color:#a47a12;font:700 18px Arial,sans-serif">${formatCurrency(order.total_amount || order.total)}</td></tr>`;
};

export const emailLayout = ({ preheader = "", header = "", body = "", footer = "" } = {}) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M1 Store</title></head>
<body style="margin:0;padding:0;background:${BRAND.paper};font-family:Arial,sans-serif;color:#171717"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${BRAND.paper}"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 35px rgba(0,0,0,.08)">${header}<tr><td style="padding:32px">${body}</td></tr>${footer}</table></td></tr></table></body></html>`;
