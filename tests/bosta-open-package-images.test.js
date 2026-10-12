import test from "node:test";
import assert from "node:assert/strict";

import { BOSTA_OPEN_PACKAGE_IMAGE_TYPE, mapOrderToBostaDeliveryPayload } from "../server/modules/shipping/providers/bosta.mapper.js";

const order = { id: 7, customer_name: "Ahmed Hasabo", customer_phone: "+201019071764", street_address: "12 El Nasr Street" };
const photo = (name) => `https://api.m1store-egy.com/uploads/products/${name}.jpg`;

// Bosta started refusing an open-package parcel that carries no photo of what is inside:
// {"success":false,"message":"Product images are required when allowToOpenPackage is enabled.",
// "errorCode":2150}. Three ready orders (INV-2029, INV-2061, INV-2072) could not be shipped.
test("asking to open the package sends the photos Bosta requires", () => {
  const payload = mapOrderToBostaDeliveryPayload({ order, codAmount: 1490, allowOpenPackage: true, productImages: [photo("a"), photo("b")] });
  assert.equal(payload.allowToOpenPackage, true);
  assert.deepEqual(payload.deliveryImages, [{ type: BOSTA_OPEN_PACKAGE_IMAGE_TYPE, images: [photo("a"), photo("b")] }]);
});

// The whole point of the fix: a parcel still ships. Keeping the flag would lose the shipment,
// so the permission is what gets dropped, never the delivery.
test("with no photo the parcel ships without the permission instead of not at all", () => {
  const payload = mapOrderToBostaDeliveryPayload({ order, codAmount: 1490, allowOpenPackage: true, productImages: [] });
  assert.equal(payload.allowToOpenPackage, false);
  assert.equal("deliveryImages" in payload, false);
});

// A relative /uploads path is served by the backend origin and by nothing else, so it reaches
// Bosta as no picture at all. Sending it would re-trigger 2150 while looking like a photo.
test("only absolute http(s) photos count, deduplicated", () => {
  const payload = mapOrderToBostaDeliveryPayload({
    order,
    allowOpenPackage: true,
    productImages: ["/uploads/products/b.jpg", "", null, photo("a"), photo("a"), "   "],
  });
  assert.deepEqual(payload.deliveryImages[0].images, [photo("a")]);
  assert.equal(payload.allowToOpenPackage, true);
});

test("Bosta's cap of ten photos per entry is respected", () => {
  const payload = mapOrderToBostaDeliveryPayload({
    order,
    allowOpenPackage: true,
    productImages: Array.from({ length: 14 }, (_item, index) => photo(`p${index}`)),
  });
  assert.equal(payload.deliveryImages[0].images.length, 10);
});

// "inherit" leaves the decision to Bosta's own account default. If that default opens the
// package, the photos must already be on the request — there is no second chance to add them.
test("inherit still carries the photos, and still sends no instruction", () => {
  const payload = mapOrderToBostaDeliveryPayload({ order, allowOpenPackage: null, productImages: [photo("a")] });
  assert.equal("allowToOpenPackage" in payload, false);
  assert.deepEqual(payload.deliveryImages[0].images, [photo("a")]);
});

// A shop that said NO hands over no ALLOW_TO_OPEN_THE_PACKAGE entry either; that entry is a
// permission, not a product gallery.
test("an explicit refusal sends no photos", () => {
  const payload = mapOrderToBostaDeliveryPayload({ order, allowOpenPackage: false, productImages: [photo("a")] });
  assert.equal(payload.allowToOpenPackage, false);
  assert.equal("deliveryImages" in payload, false);
});

// An exchange is the same one parcel, and Bosta applies the same rule to it.
test("an exchange parcel carries its photos too", () => {
  const payload = mapOrderToBostaDeliveryPayload({
    order,
    allowOpenPackage: true,
    productImages: [photo("a")],
    exchange: { items_count: 1, description: "Exchanged item" },
  });
  assert.equal(payload.type, 30);
  assert.equal(payload.allowToOpenPackage, true);
  assert.deepEqual(payload.deliveryImages[0].images, [photo("a")]);
});

// The images come off the order lines, and /uploads is served by the BACKEND host alone: the
// storefront answers every unknown path with index.html and HTTP 200, so an upload pointed at
// the app origin reaches Bosta as 34 KB of HTML. Resolving them is the half of the fix that
// decides whether the first test above ever gets a photo to send.
test("order lines become absolute backend photo URLs", async () => {
  process.env.PUBLIC_BACKEND_URL = "https://api.m1store-egy.com";
  const { bostaOpenPackageImages } = await import("../server/modules/shipping/shipping.service.js");
  const images = bostaOpenPackageImages([
    { image_url: "/uploads/products/a.jpg" },
    { image_url: "uploads/products/b.jpg" },
    { image_url: "https://res.cloudinary.com/m1/c.jpg" },
    { image_url: "" },
    {},
    { image_url: "/uploads/products/a.jpg" },
  ]);
  assert.deepEqual(images, [
    "https://api.m1store-egy.com/uploads/products/a.jpg",
    "https://api.m1store-egy.com/uploads/products/b.jpg",
    "https://res.cloudinary.com/m1/c.jpg",
  ]);
});
