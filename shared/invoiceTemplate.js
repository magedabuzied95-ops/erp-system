// Customer-facing invoice template — THE canonical shape of "what the customer sees".
// ----------------------------------------------------------------------------------
// Operator surface: Invoice Studio (/settings/invoice)
// Storage:          invoice_templates.config (jsonb), tenant-scoped, many rows per tenant
// API:              /api/invoice-templates (server/routes/invoiceTemplates.js)
//
// The invoice is drawn by FOUR renderers, each of which used to carry its own copy of
// the labels, the store phone and the return policy. They all read this config now:
//   1. src/shared/components/invoices/OrderInvoiceCard.jsx  (order details, public link, storefront)
//   2. src/shared/utils/invoicePdf.js                       (A4 + thermal PDF/print)
//   3. ReceiptPreview in src/modules/pos/components/CartSidebar.jsx (80mm cashier receipt)
//   4. buildOrderInvoiceWhatsappText in src/shared/utils/orderInvoice.js (WhatsApp text)
//
// `fields`/`totals` here are per-element visibility; `blocks` is the layout — what
// appears, in what order, and anything the operator added.
//
// DEFAULTS ARE NOT A DESIGN CHOICE. Every value below is transcribed from what the code
// already renders, so an un-configured tenant sees exactly what it sees today. When a
// field is meant to inherit from somewhere else (tenant branding, the phone), the
// default is "" and the renderer keeps its existing fallback chain.

import { DEFAULT_INVOICE_BLOCKS, normalizeInvoiceBlocks } from "./invoiceBlocks.js";

export const INVOICE_TEMPLATE_CONFIG_VERSION = 1;

// Which sales channel a template applies to. "all" is the catch-all every tenant starts with.
export const INVOICE_TEMPLATE_CHANNELS = ["all", "website", "pos", "manual"];

// The four things a template comes out as, named after the renderer that produces each.
// Not a filter — every template drives all four.
//   card     OrderInvoiceCard: the order page, the public /invoice/:token link, the
//            storefront confirmation. This is the shared baseline; it has no override
//            block because the shared `fields` ARE its settings.
//   print    invoicePdf at A4
//   thermal  the 80mm roll — invoicePdf's thermal format and the POS receipt. Inherits
//            print's overrides, then applies its own.
//   whatsapp the plain-text message
export const INVOICE_TEMPLATE_OUTPUTS = ["card", "print", "thermal", "whatsapp"];

// The customer reads ONE of two policies, never both.
//
// Two of the five old lines were about who pays the shipping, which is noise to someone
// who walked into the branch, paid at the counter and carried the box out — and it was
// the only policy the public link had, so that is exactly what a walk-in customer read.
// resolveInvoicePolicyLines() picks between the two from the order itself.
//
// The window in both is prose, not logic — orders.return_exchange_window_days is what
// the storefront policy page reads. Keep them in step by hand until the studio surfaces
// both together.
export const DEFAULT_RETURN_POLICY_AR = [
  "متاح الاستبدال أو الاسترجاع خلال 14 يوم من استلام الطلب.",
  "بشرط:",
  "• المنتج بحالته الأصلية وغير مستخدم.",
  "• الفاتورة دي هي إثبات الشراء، احتفظ بالرابط.",
  "• عيب في المنتج؟ الشحن علينا.",
  "• تغيير مقاس أو لون؟ تكلفة الشحن رايح وجاي عليك.",
  "• الشنط غير قابلة للاستبدال أو الاسترجاع.",
].join("\n");

// The counter sale: no shipping clause, because nothing was shipped. The bag exclusion
// was already printed on the 80mm receipt and had never reached the link the customer
// opens on their phone — this is where those two documents stop disagreeing.
export const DEFAULT_RETURN_POLICY_IN_STORE_AR = [
  "متاح الاستبدال أو الاسترجاع خلال 14 يوم من تاريخ الاستلام.",
  "• المنتج بحالته الأصلية وغير مستخدم.",
  "• الشنط غير قابلة للاستبدال أو الاسترجاع.",
].join("\n");

export const INVOICE_TEMPLATE_DEFAULTS = Object.freeze({
  version: INVOICE_TEMPLATE_CONFIG_VERSION,

  // The document itself: which sections appear, in what order, and anything the operator
  // added between them. See shared/invoiceBlocks.js — the default list reproduces the
  // layout the renderers had written into them.
  blocks: DEFAULT_INVOICE_BLOCKS,

  // Empty string means "keep the renderer's existing fallback" — for name and logo that
  // is getTenantBranding() in src/shared/utils/orderInvoice.js, which already reads
  // general.company_name / general.company_logo_url. Filling these in overrides it.
  identity: {
    store_name: "",
    logo_url: "",
    show_logo: true,
    // Hardcoded in PublicInvoice.jsx and orderInvoice.js today.
    phone: "01000659301",
    website_text: "Www.m1store-egy.com",
    website_url: "https://www.m1store-egy.com",
    address: "",
    tax_number: "",
    commercial_register: "",
  },

  // Per-element visibility, in the order the invoice reads top to bottom. The invoice
  // number is deliberately absent: it identifies the document, it is not a display
  // preference, and every renderer prints it unconditionally.
  fields: {
    show_order_date: true,
    show_customer_name: true,
    show_customer_phone: true,
    show_customer_address: true,
    show_order_status: true,
    show_payment_method: true,
    // Line columns. OrderInvoiceCard prints the SKU under the product name whenever the
    // line carries one, so the shared default is on; the PDF, which omits it today,
    // keeps omitting it through the `print` override below.
    show_product_image: true,
    show_product_variant: true,
    show_sku: true,
    show_unit_price: true,
    show_line_total: true,
    // Staff attribution. On today's invoices these print wherever the document carries
    // them — the PDF names the seller, the cashier receipt names both — and the
    // on-screen card has no such field at all, so a shared default of on changes
    // nothing anywhere.
    show_seller_name: true,
    show_cashier_name: true,
  },

  totals: {
    show_subtotal: true,
    show_discount: true,
    show_shipping: true,
    // No renderer prints a tax row today even though orders carry the column.
    show_tax: false,
    show_grand_total: true,
    show_paid: true,
    show_remaining: true,
    show_payment_breakdown: true,
  },

  footer: {
    thank_you_ar: "",
    thank_you_en: "",
    return_policy_enabled: true,
    return_policy_ar: DEFAULT_RETURN_POLICY_AR,
    return_policy_en: "",
    // What a counter sale shows instead. Empty falls back to the online text, so an
    // operator who clears it loses a tailored policy, never the policy itself.
    return_policy_in_store_ar: DEFAULT_RETURN_POLICY_IN_STORE_AR,
    return_policy_in_store_en: "",
    terms_ar: "",
    terms_en: "",
    // New capability, off so it changes nothing until someone turns it on.
    show_public_link_qr: false,
  },

  // Transcribed from DEFAULT_SOCIAL_LINKS in src/pages/PublicInvoice.jsx.
  social: {
    enabled: true,
    google_review_url:
      "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
    facebook_review_url: "https://www.facebook.com/share/1DmN6zj29g/?mibextid=wwXIfr",
    instagram_url: "https://www.instagram.com/m1store_egy?igsh=MWplb2d4cmJ4YmxhaQ%3D%3D&utm_source=qr",
    // Empty derives the wa.me link from identity.phone, which is what PublicInvoice does today.
    whatsapp_number: "",
  },

  // Where the four renderers genuinely disagree today. Everything NOT listed here is
  // shared, which is the whole point — one edit, four channels. Each value is what that
  // renderer already produces, so wiring it up changes nothing on its own.
  outputs: {
    print: {
      // The PDF has never printed the SKU, unlike the on-screen/public card.
      show_sku: false,
    },
    thermal: {
      paper_width_mm: 80,
      // The 80mm receipt drops images and the unit-price column for width reasons.
      show_product_image: false,
      show_unit_price: false,
    },
    whatsapp: {
      include_items: true,
      include_totals: true,
      include_public_link: true,
    },
  },
});

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const coerceBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return fallback;
};

const toText = (value, fallback = "", maxLength = 500) =>
  String(value ?? fallback ?? "").trim().slice(0, maxLength);

// A link the customer will click. Anything that is not http(s) is dropped rather than
// stored, so a typo can never render as a dead or hostile link on a public invoice.
const toPublicUrl = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  // An absent value means "unset", which is what the fallback is for. Returning "" here
  // silently emptied the review links and the website on any config normalized from a
  // bare {} — which is exactly what a renderer falls back to when the template endpoint
  // is unreachable, so the customer lost those links precisely when nothing else worked.
  if (!text) return fallback;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return fallback;
  }
  return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : fallback;
};

export const normalizeInvoiceTemplateChannel = (value) => {
  const text = String(value || "").trim().toLowerCase();
  return INVOICE_TEMPLATE_CHANNELS.includes(text) ? text : "all";
};

// Unknown keys are dropped, not merged. A template row is rendered onto a customer's
// invoice, so the config can only ever hold fields this module knows how to render.
export const normalizeInvoiceTemplateConfig = (config = {}) => {
  const input = config && typeof config === "object" ? config : {};
  const identity = input.identity && typeof input.identity === "object" ? input.identity : {};
  const fields = input.fields && typeof input.fields === "object" ? input.fields : {};
  const totals = input.totals && typeof input.totals === "object" ? input.totals : {};
  const footer = input.footer && typeof input.footer === "object" ? input.footer : {};
  const social = input.social && typeof input.social === "object" ? input.social : {};
  const outputs = input.outputs && typeof input.outputs === "object" ? input.outputs : {};
  const print = outputs.print && typeof outputs.print === "object" ? outputs.print : {};
  const thermal = outputs.thermal && typeof outputs.thermal === "object" ? outputs.thermal : {};
  const whatsapp = outputs.whatsapp && typeof outputs.whatsapp === "object" ? outputs.whatsapp : {};

  const defaults = INVOICE_TEMPLATE_DEFAULTS;
  const booleanGroup = (source, defaultGroup) =>
    Object.keys(defaultGroup).reduce((acc, key) => {
      acc[key] = coerceBoolean(source[key], defaultGroup[key]);
      return acc;
    }, {});

  return {
    version: INVOICE_TEMPLATE_CONFIG_VERSION,
    // Absent blocks mean "the layout was never touched", which normalizeInvoiceBlocks
    // answers with the default list rather than an empty invoice.
    blocks: normalizeInvoiceBlocks(input.blocks),
    identity: {
      store_name: toText(identity.store_name, defaults.identity.store_name, 160),
      logo_url: toPublicUrl(identity.logo_url, defaults.identity.logo_url),
      show_logo: coerceBoolean(identity.show_logo, defaults.identity.show_logo),
      phone: toText(identity.phone, defaults.identity.phone, 40),
      website_text: toText(identity.website_text, defaults.identity.website_text, 160),
      website_url: toPublicUrl(identity.website_url, defaults.identity.website_url),
      address: toText(identity.address, defaults.identity.address, 300),
      tax_number: toText(identity.tax_number, defaults.identity.tax_number, 60),
      commercial_register: toText(identity.commercial_register, defaults.identity.commercial_register, 60),
    },
    fields: booleanGroup(fields, defaults.fields),
    totals: booleanGroup(totals, defaults.totals),
    footer: {
      thank_you_ar: toText(footer.thank_you_ar, defaults.footer.thank_you_ar, 300),
      thank_you_en: toText(footer.thank_you_en, defaults.footer.thank_you_en, 300),
      return_policy_enabled: coerceBoolean(footer.return_policy_enabled, defaults.footer.return_policy_enabled),
      return_policy_ar: toText(footer.return_policy_ar, defaults.footer.return_policy_ar, 4000),
      return_policy_en: toText(footer.return_policy_en, defaults.footer.return_policy_en, 4000),
      return_policy_in_store_ar: toText(footer.return_policy_in_store_ar, defaults.footer.return_policy_in_store_ar, 4000),
      return_policy_in_store_en: toText(footer.return_policy_in_store_en, defaults.footer.return_policy_in_store_en, 4000),
      terms_ar: toText(footer.terms_ar, defaults.footer.terms_ar, 4000),
      terms_en: toText(footer.terms_en, defaults.footer.terms_en, 4000),
      show_public_link_qr: coerceBoolean(footer.show_public_link_qr, defaults.footer.show_public_link_qr),
    },
    social: {
      enabled: coerceBoolean(social.enabled, defaults.social.enabled),
      google_review_url: toPublicUrl(social.google_review_url, defaults.social.google_review_url),
      facebook_review_url: toPublicUrl(social.facebook_review_url, defaults.social.facebook_review_url),
      instagram_url: toPublicUrl(social.instagram_url, defaults.social.instagram_url),
      whatsapp_number: toText(social.whatsapp_number, defaults.social.whatsapp_number, 40),
    },
    outputs: {
      print: {
        show_sku: coerceBoolean(print.show_sku, defaults.outputs.print.show_sku),
      },
      thermal: {
        paper_width_mm: clampNumber(thermal.paper_width_mm, defaults.outputs.thermal.paper_width_mm, 48, 112),
        show_product_image: coerceBoolean(thermal.show_product_image, defaults.outputs.thermal.show_product_image),
        show_unit_price: coerceBoolean(thermal.show_unit_price, defaults.outputs.thermal.show_unit_price),
      },
      whatsapp: {
        include_items: coerceBoolean(whatsapp.include_items, defaults.outputs.whatsapp.include_items),
        include_totals: coerceBoolean(whatsapp.include_totals, defaults.outputs.whatsapp.include_totals),
        include_public_link: coerceBoolean(whatsapp.include_public_link, defaults.outputs.whatsapp.include_public_link),
      },
    },
  };
};

// A PATCH from the studio carries only the groups the operator touched. Merge one level
// deep (plus the two output blocks) and let normalize drop anything unknown.
export const mergeInvoiceTemplateConfig = (base = {}, patch = {}) => {
  const current = normalizeInvoiceTemplateConfig(base);
  const incoming = patch && typeof patch === "object" ? patch : {};
  const group = (key) => ({ ...current[key], ...(incoming[key] && typeof incoming[key] === "object" ? incoming[key] : {}) });
  const outputGroup = (key) => ({
    ...current.outputs[key],
    ...(incoming.outputs?.[key] && typeof incoming.outputs[key] === "object" ? incoming.outputs[key] : {}),
  });

  return normalizeInvoiceTemplateConfig({
    // Blocks are an ordered list, not a keyed group: a patch that carries one replaces
    // the layout wholesale, because "merging" two orderings has no sensible meaning.
    blocks: Array.isArray(incoming.blocks) ? incoming.blocks : current.blocks,
    identity: group("identity"),
    fields: group("fields"),
    totals: group("totals"),
    footer: group("footer"),
    social: group("social"),
    outputs: {
      print: outputGroup("print"),
      thermal: outputGroup("thermal"),
      whatsapp: outputGroup("whatsapp"),
    },
  });
};

// Which template an invoice renders with. Most specific wins, and a template pinned on
// the order always wins — an invoice already sent to a customer keeps rendering with the
// template it was issued under, even after the tenant's default changes.
//
//   1. templateId          — pinned on the order at issue time
//   2. branch + channel    — a branch that prints its own invoice for one channel
//   3. branch, any channel
//   4. channel, any branch
//   5. the tenant default
//   6. nothing configured  — caller falls back to INVOICE_TEMPLATE_DEFAULTS
export const resolveInvoiceTemplate = (templates = [], { templateId = null, channel = "all", branchId = null } = {}) => {
  const rows = Array.isArray(templates) ? templates.filter(Boolean) : [];
  if (!rows.length) return null;

  if (templateId) {
    const pinned = rows.find((row) => String(row.id) === String(templateId));
    if (pinned) return pinned;
  }

  const wantedChannel = normalizeInvoiceTemplateChannel(channel);
  const sameBranch = (row) => branchId && String(row.scope_branch_id ?? "") === String(branchId);
  const anyBranch = (row) => row.scope_branch_id === null || row.scope_branch_id === undefined;
  const sameChannel = (row) => normalizeInvoiceTemplateChannel(row.scope_channel) === wantedChannel && wantedChannel !== "all";
  const anyChannel = (row) => normalizeInvoiceTemplateChannel(row.scope_channel) === "all";

  return (
    rows.find((row) => sameBranch(row) && sameChannel(row)) ||
    rows.find((row) => sameBranch(row) && anyChannel(row)) ||
    rows.find((row) => anyBranch(row) && sameChannel(row)) ||
    rows.find((row) => anyBranch(row) && anyChannel(row) && row.is_default) ||
    rows.find((row) => row.is_default) ||
    null
  );
};

// What a renderer actually consumes: always a full config, never null.
export const resolveInvoiceTemplateConfig = (templates = [], options = {}) => {
  const template = resolveInvoiceTemplate(templates, options);
  return normalizeInvoiceTemplateConfig(template?.config || {});
};

// The config a single output should render with, after its own overrides are folded in.
// Callers pass an output name so a thermal renderer never has to work out which of the
// shared flags its narrow paper overrides. "card" is the shared config unchanged.
export const invoiceTemplateForOutput = (config = {}, output = "card") => {
  const normalized = normalizeInvoiceTemplateConfig(config);
  if (output !== "print" && output !== "thermal") return normalized;

  // Thermal is produced by the same PDF builder as A4, so it inherits print's
  // overrides before applying the ones the 80mm roll adds.
  const fields = { ...normalized.fields, show_sku: normalized.outputs.print.show_sku };
  if (output === "thermal") {
    fields.show_product_image = normalized.outputs.thermal.show_product_image;
    fields.show_unit_price = normalized.outputs.thermal.show_unit_price;
  }
  return { ...normalized, fields };
};

// Which of the two return policies this invoice carries.
//
// The channel alone is the wrong question. The POS sells delivery orders too, and on
// those the shipping clauses are exactly right — what actually decides it is whether
// anything was shipped at all. A counter sale has no shipping line.
//
// Anything we cannot classify falls to the online text, which is the superset: an
// unknown order shows the customer MORE of what they are owed, never less.
const IN_STORE_INVOICE_SOURCES = new Set(["pos", "offline", "cashier", "store", "branch", "in_store"]);

export const isInStoreInvoice = (invoice = {}) => {
  const source = String(invoice?.source ?? invoice?.channel ?? "").trim().toLowerCase();
  if (!IN_STORE_INVOICE_SOURCES.has(source)) return false;
  const shipping = Number(
    invoice?.totals?.shipping ?? invoice?.shipping_cost ?? invoice?.shippingCost ?? invoice?.shipping ?? 0
  );
  return !Number.isFinite(shipping) || shipping <= 0;
};

// The policy for one invoice, as the lines it is made of. The four renderers disagree
// about how to draw a line — a div, a table row, one wrapped paragraph on an 80mm roll —
// but they must never disagree about WHICH lines they were handed, which is how the
// bag exclusion ended up printed on the cashier's receipt and nowhere else.
//
// The first line is the headline and the rest are its conditions; a renderer that can
// collapse (the phone) hides everything after [0] behind a toggle.
export const resolveInvoicePolicyLines = (config = {}, { invoice = {}, language = "ar" } = {}) => {
  const footer = {
    ...INVOICE_TEMPLATE_DEFAULTS.footer,
    ...(config?.footer && typeof config.footer === "object" ? config.footer : {}),
  };
  if (!footer.return_policy_enabled) return [];
  const english = language === "en";
  const online = (english && footer.return_policy_en) || footer.return_policy_ar;
  const text = isInStoreInvoice(invoice)
    ? (english && footer.return_policy_in_store_en) || footer.return_policy_in_store_ar || online
    : online;
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
};
