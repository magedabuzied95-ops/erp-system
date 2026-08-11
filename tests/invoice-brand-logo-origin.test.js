import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderInvoice = readFileSync("src/shared/utils/orderInvoice.js", "utf8");
const invoiceCard = readFileSync("src/shared/components/invoices/OrderInvoiceCard.jsx", "utf8");
const invoicePdf = readFileSync("src/shared/utils/invoicePdf.js", "utf8");
const posReceipt = readFileSync("src/modules/pos/components/CartSidebar.jsx", "utf8");

test("server-hosted brand images resolve through the API asset origin", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "m1store-egy.com",
      port: "",
      origin: "https://m1store-egy.com",
    },
  };
  try {
    const { resolveBrandImageUrl } = await import(`../src/shared/lib/imageUrls.js?invoice-brand=${Date.now()}`);
    const resolved = resolveBrandImageUrl("/uploads/products/cloudinary/store-logo.jpg");
    assert.match(resolved, /^https?:\/\//);
    assert.doesNotMatch(resolved, /^https:\/\/m1store-egy\.com\/uploads\//);
    assert.match(resolved, /\/uploads\/products\/cloudinary\/store-logo\.jpg$/);
    assert.equal(
      resolveBrandImageUrl("/branding/m-one-logo-white-fixed.png"),
      "https://m1store-egy.com/branding/m-one-logo-white-fixed.png",
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("all invoice surfaces normalize the store logo before rendering or printing", () => {
  assert.match(orderInvoice, /resolveBrandImageUrl\(candidates/);
  assert.match(invoiceCard, /logoUrl: resolveBrandImageUrl/);
  assert.match(invoicePdf, /resolveBrandImageUrl\(String\(/);
  assert.match(posReceipt, /const logoUrl = resolveBrandImageUrl\(value\)/);
});
