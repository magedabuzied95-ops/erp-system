const CHANNEL_PREFIXES = {
  storefront: "WEB",
  website: "WEB",
  web: "WEB",
  web_chat: "WEB",
  pos: "POS",
  instagram: "IG",
  ig: "IG",
  tiktok: "TT",
  tt: "TT",
  facebook: "FB",
  fb: "FB",
  whatsapp: "WA",
};

const cleanText = (value = "") => String(value ?? "").trim();

export const publicOrderPrefixForChannel = (channel = "") => {
  const normalized = cleanText(channel).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return CHANNEL_PREFIXES[normalized] || CHANNEL_PREFIXES[normalized.replace(/_chat$/, "")] || "WEB";
};

export const generatePublicOrderNumber = (channel = "website", orderId = "") => {
  const id = cleanText(orderId);
  if (!id) return "";
  return `${publicOrderPrefixForChannel(channel)}-${id}`;
};

export const displayPublicOrderNumber = (orderOrNumber = "", fallbackChannel = "website") => {
  if (orderOrNumber && typeof orderOrNumber === "object") {
    const explicit = cleanText(orderOrNumber.public_order_number || orderOrNumber.display_order_number || orderOrNumber.order_number);
    if (explicit) return displayPublicOrderNumber(explicit, orderOrNumber.channel || orderOrNumber.source || fallbackChannel);

    const invoiceValue = cleanText(orderOrNumber.invoice_number || orderOrNumber.invoiceNumber || "");
    const legacyInvoice = invoiceValue.match(/^(WEB|AI)-\d{10,}-(\d{1,})$/i);
    if (legacyInvoice) return `${publicOrderPrefixForChannel(orderOrNumber.channel || orderOrNumber.source || fallbackChannel)}-${legacyInvoice[2]}`;

    return generatePublicOrderNumber(orderOrNumber.channel || orderOrNumber.source || fallbackChannel, orderOrNumber.id) || invoiceValue;
  }

  const value = cleanText(orderOrNumber);
  if (!value) return "";

  const legacyWebsiteMatch = value.match(/^WEB-\d{10,}-(\d{1,})$/i);
  if (legacyWebsiteMatch) return `WEB-${legacyWebsiteMatch[1]}`;

  const legacyAiMatch = value.match(/^AI-\d{10,}-(\d{1,})$/i);
  if (legacyAiMatch) return `WEB-${legacyAiMatch[1]}`;

  return value;
};

export const attachPublicOrderNumber = (order = {}, fallbackChannel = "website") => {
  if (!order || typeof order !== "object") return order;
  const publicOrderNumber =
    displayPublicOrderNumber(order.public_order_number || order.display_order_number || "", order.channel || order.source || fallbackChannel) ||
    displayPublicOrderNumber(order, fallbackChannel);

  return {
    ...order,
    public_order_number: publicOrderNumber,
    display_order_number: publicOrderNumber,
  };
};
