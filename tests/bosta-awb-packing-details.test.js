import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

process.env.PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL || "https://api.example.test";

const {
  buildPackingDescription,
  describePackingItem,
  packingToken,
  renderPackingPage,
  stampPackingQrOnAirwayBill,
  verifyPackingToken,
} = await import("../server/modules/shipping/packingSlip.js");
const { mapOrderToBostaDeliveryPayload } = await import("../server/modules/shipping/providers/bosta.mapper.js");

test("each piece is described with colour, size, article code and quantity", () => {
  assert.equal(
    describePackingItem({ product_name: "Adidas Ultra Boost", color: "Grey", size: "39", article_code: "ART-12345", quantity: 1 }),
    "Adidas Ultra Boost - Grey - مقاس 39 - ART-12345 (x1)"
  );
  assert.equal(describePackingItem({ product_name: "Crocs Classic", size: "M9", quantity: 2 }), "Crocs Classic - مقاس M9 (x2)", "no article, no empty dash");
});

test("a long parcel counts the pieces it could not fit instead of dropping them", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ product_name: `Model number ${index} with a fairly long name`, color: "Black", size: "42", article_code: `ART-${index}`, quantity: 1 }));
  const description = buildPackingDescription(items);
  assert.match(description, /\+ \d+ قطع تانية$/);
  assert.ok(description.length <= 440);
});

test("the Bosta payload uses the detailed description, and falls back to names when it is off", () => {
  const base = { order: { id: 9, customer_name: "Hadeer Ahmed" }, items: [{ product_name: "Adidas Ultra Boost" }] };
  assert.equal(mapOrderToBostaDeliveryPayload({ ...base, description: "Adidas Ultra Boost - Grey - مقاس 39 (x1)" }).specs.packageDetails.description, "Adidas Ultra Boost - Grey - مقاس 39 (x1)");
  assert.equal(mapOrderToBostaDeliveryPayload(base).specs.packageDetails.description, "Adidas Ultra Boost");
});

test("the packing link is signed per order, so ids cannot be walked", () => {
  const token = packingToken(1616);
  assert.equal(verifyPackingToken(token), 1616);
  assert.equal(verifyPackingToken(token.replace(/^1616/, "1617")), null);
  assert.equal(verifyPackingToken("1616.forged"), null);
  assert.equal(verifyPackingToken(""), null);
});

test("the packing page shows the models and nothing about money or the customer", () => {
  const html = renderPackingPage({
    orderNumber: "INV-1616",
    items: [{ product_name: "Adidas <Ultra> Boost", color: "Grey", size: "39", article_code: "ART-1", quantity: 1, image_url: "https://res.cloudinary.com/x/shoe.jpg", unit_price: 1200 }],
  });
  assert.match(html, /INV-1616/);
  assert.match(html, /shoe\.jpg/);
  assert.match(html, /مقاس <b dir="ltr">39<\/b>/);
  assert.match(html, /ART-1/);
  assert.match(html, /Adidas &lt;Ultra&gt; Boost/, "names are escaped");
  assert.doesNotMatch(html, /1200|جنيه/);
  assert.match(html, /noindex/);
});

const blankPdf = async (pages) => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([288, 432]);
  return Buffer.from(await pdf.save()).toString("base64");
};

test("every airway bill page gets a QR strip added under it, the label itself untouched", async () => {
  const result = await stampPackingQrOnAirwayBill(await blankPdf(2), [{ order_id: 1, order_number: "INV-1" }, { order_id: 2, order_number: "INV-2" }]);
  assert.equal(result.stamped, true);
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  for (const page of pdf.getPages()) {
    const box = page.getMediaBox();
    assert.equal(box.height, 432 + 96);
    assert.equal(box.y, -96, "the page grows downwards; Bosta's label keeps its own area");
  }
});

test("a page count that does not match the orders prints the plain label rather than a wrong QR", async () => {
  const original = await blankPdf(1);
  const result = await stampPackingQrOnAirwayBill(original, [{ order_id: 1 }, { order_id: 2 }]);
  assert.equal(result.stamped, false);
  assert.equal(result.pdf_base64, original);
});
