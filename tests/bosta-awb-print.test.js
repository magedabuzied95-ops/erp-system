import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";

import { createBostaClient } from "../server/modules/shipping/providers/bosta.client.js";
import { normalizeBostaAwbResponse } from "../server/modules/shipping/providers/bosta.mapper.js";

const shippingServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8");
const centerServiceSource = readFileSync(new URL("../server/modules/shipping/shipping.center.service.js", import.meta.url), "utf8");
const centerPageSource = readFileSync(new URL("../src/modules/shipping/pages/ShippingCenter.jsx", import.meta.url), "utf8");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");

const withFakeBosta = async (handler, run) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = createBostaClient({ apiKey: "test-key", apiBaseUrl: `http://127.0.0.1:${server.address().port}/api/v2` });
    return await run(client, requests);
  } finally {
    server.close();
  }
};

const respondJson = (body) => (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

// Bosta's create-delivery reply carries no label at all, so the label has to be
// pulled at print time. Reading the stored column was the original bug: it was
// empty on every order, the client filtered the empty urls away, and the page
// still showed a success toast over a print that opened nothing.
test("the label is fetched from Bosta at print time, not read off the order", () => {
  assert.match(shippingServiceSource, /export const fetchBostaShipmentLabels/);
  assert.match(centerServiceSource, /if \(action === "print_labels"\) \{\s*return fetchBostaShipmentLabels\(ids\);/);

  const printBranch = centerServiceSource.slice(centerServiceSource.indexOf('action === "print_labels"'));
  assert.doesNotMatch(printBranch.slice(0, 400), /shipping_label_url/);
});

test("one bulk print is one Bosta call carrying every delivery id", async () => {
  const { requests } = await withFakeBosta(respondJson({ success: true, data: PDF.toString("base64") }), async (client, requests) => {
    await client.massAirwayBill(["68096915", "266980385", "8560898378"], { lang: "ar" });
    return { requests };
  });

  assert.equal(requests.length, 1, "labels must not be fetched one request per order");
  // Bosta's own WooCommerce client sends a raw comma list; a %2C separator is
  // not worth betting a bulk print on.
  assert.equal(requests[0].url, "/api/v2/deliveries/mass-awb?ids=68096915,266980385,8560898378&lang=ar");
  assert.equal(requests[0].authorization, "test-key", "the api key goes in the header verbatim, with no Bearer prefix");
});

test("the merged airway bill survives the round trip as a PDF", async () => {
  const awb = await withFakeBosta(respondJson({ success: true, data: PDF.toString("base64") }), async (client) =>
    normalizeBostaAwbResponse(await client.massAirwayBill(["68096915"]))
  );
  assert.equal(awb.error, "");
  assert.deepEqual(Buffer.from(awb.pdf_base64, "base64"), PDF);
});

test("both AWB response shapes decode, and a non-PDF body fails loudly", () => {
  const base64 = PDF.toString("base64");
  assert.equal(normalizeBostaAwbResponse({ data: base64 }).byte_length, PDF.length, "mass-awb nests the base64 directly under data");
  assert.equal(normalizeBostaAwbResponse({ data: { data: base64 } }).byte_length, PDF.length, "the single-delivery endpoint nests it one level deeper");
  assert.equal(normalizeBostaAwbResponse({ data: `data:application/pdf;base64,${base64}` }).byte_length, PDF.length);

  // A blank tab is worse than an error: an HTML error page or a truncated body
  // must not reach the browser dressed up as a label.
  const html = normalizeBostaAwbResponse({ data: Buffer.from("<html>error</html>").toString("base64") });
  assert.equal(html.pdf_base64, "");
  assert.match(html.error, /not a PDF/);
  assert.match(normalizeBostaAwbResponse({ message: "Delivery not found" }).error, /Delivery not found/);
  assert.equal(normalizeBostaAwbResponse({}).pdf_base64, "");
});

test("a print with nothing shippable is refused instead of silently succeeding", () => {
  const body = shippingServiceSource.slice(shippingServiceSource.indexOf("export const fetchBostaShipmentLabels"));
  const end = body.indexOf("export const refreshBostaShipmentForOrder");
  const fetchBody = body.slice(0, end > 0 ? end : undefined);

  assert.match(fetchBody, /if \(!printable\.length\) \{[\s\S]{0,200}code = "BOSTA_NO_PRINTABLE_LABEL"/);
  assert.match(fetchBody, /if \(!awb\.pdf_base64\) \{[\s\S]{0,300}code = "BOSTA_AWB_EMPTY"/);
  // Every order the user selected is accounted for, with a reason.
  for (const reason of ["order_not_found", "provider_unsupported", "shipment_not_created"]) {
    assert.match(fetchBody, new RegExp(`reason: "${reason}"`), `skipped orders must report ${reason}`);
  }
  // Reprinting stays open while the integration is switched off, the same rule
  // refresh and cancel follow: parcels already with the courier still need labels.
  assert.doesNotMatch(fetchBody, /bostaDisabledError/);
});

test("the print opens one tab, claimed before the request", () => {
  const printBody = centerPageSource.slice(centerPageSource.indexOf("const printLabels ="));
  const openIndex = printBody.indexOf('window.open("", "_blank")');
  const awaitIndex = printBody.indexOf("await api.post");
  assert.ok(openIndex > 0 && awaitIndex > openIndex, "the tab must be claimed inside the click, before the await");

  // The old code opened one popup per label after the round trip, so the blocker
  // ate every one of them.
  assert.doesNotMatch(printBody, /forEach\(\(url\) => window\.open/);
  assert.match(printBody, /if \(printWindow && !printWindow\.closed\) printWindow\.location\.href = url;\s*else downloadPdf\(url\);/);
  assert.doesNotMatch(centerPageSource, /label_url/, "the client no longer reads a label url off the order");
});
