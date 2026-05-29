import crypto from "node:crypto";

const cleanText = (value = "") => String(value ?? "").trim();

export const normalizeInvoicePrefix = (value = "INV") =>
  cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "INV";

export const buildInvoiceNumber = (orderId, { prefix = "INV", branchPrefix = "" } = {}) => {
  const id = cleanText(orderId);
  if (!id) return "";
  const basePrefix = normalizeInvoicePrefix(prefix);
  const branch = cleanText(branchPrefix)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return [basePrefix, branch, id].filter(Boolean).join("-");
};

export const buildTemporaryInvoiceNumber = () => `INV-PENDING-${crypto.randomUUID()}`;

export const buildDerivedInvoiceNumber = (invoiceNumber = "", suffix = "") => {
  const base = cleanText(invoiceNumber);
  const safeSuffix = normalizeInvoicePrefix(suffix);
  return base ? `${base}-${safeSuffix}` : "";
};

export const assignSequentialInvoiceNumber = async (
  client,
  order = {},
  { prefix = "INV", branchPrefix = "", updatePublicOrderNumber = true } = {}
) => {
  const invoiceNumber = buildInvoiceNumber(order.id, { prefix, branchPrefix });
  if (!invoiceNumber) return order;

  const publicAssignments = updatePublicOrderNumber
    ? `,
        public_order_number = $2,
        display_order_number = $2`
    : "";

  const result = await client.query(
    `
    UPDATE orders
    SET invoice_number = $2${publicAssignments}
    WHERE id = $1
    RETURNING *
    `,
    [order.id, invoiceNumber]
  );

  return result.rows[0] || { ...order, invoice_number: invoiceNumber };
};
