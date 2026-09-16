/*
 * What an exchange tells the courier, kept away from every heavy module so the shipping
 * side can read it without pulling the orders controller in behind it.
 */
const text = (value = "") => String(value ?? "").trim();

// The line the courier reads on an exchange parcel: what he is taking back.
export const describeExchangeReturnParcel = (lines = []) => {
  const list = Array.isArray(lines) ? lines : [];
  const description = list
    .map((line) => [line.product_name, line.color, line.size, Number(line.quantity) > 1 ? `x${line.quantity}` : ""].map(text).filter(Boolean).join(" "))
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  return {
    items_count: list.reduce((sum, line) => sum + Math.max(1, Number(line.quantity || 1)), 0) || 1,
    description: description || "Exchanged item",
  };
};

const parseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * The exchange an order carries, or null. Read from the order alone, so the shipping
 * side never has to know how an exchange was created - only that this parcel owes the
 * shop a piece on the way back.
 */
export const exchangeParcelContextOf = (order = {}) => {
  const exchange = parseMetadata(order.ai_agent_metadata).exchange;
  if (!exchange || typeof exchange !== "object") return null;
  const lines = Array.isArray(exchange.return_lines) ? exchange.return_lines : [];
  if (!lines.length) return null;
  const parcel = describeExchangeReturnParcel(lines);
  const invoice = text(exchange.original_invoice_number) || text(exchange.original_order_id);
  return {
    ...parcel,
    original_order_id: exchange.original_order_id || null,
    return_id: exchange.return_id || null,
    notes: invoice ? `استبدال فاتورة ${invoice}: ${parcel.description}` : `استبدال: ${parcel.description}`,
  };
};
