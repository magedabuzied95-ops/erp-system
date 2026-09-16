import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A customer who already bought from this browser should find the checkout filled in.
// The details are kept on the device, never fetched by phone number, because the server
// only hands saved addresses to a signed-in customer — a lookup a guest could make would
// let anyone type a stranger's number and read where they live.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const storefront = read("src/storefront/Storefront.jsx");
const accountPage = read("src/storefront/pages/StorefrontAccountPage.jsx");

// The helpers live in a component file that cannot be imported here, so the test runs the
// real source: a rewritten guard (a dropped expiry, a field that stops being saved) fails.
const slice = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
};

const loadDeviceMemory = () => {
  const store = new Map();
  const source = [
    slice(storefront, "const CHECKOUT_ADDRESS_FIELDS = [", "// The fields that describe the place"),
    slice(storefront, "const readStorefrontStorage = (key, fallback)", "const readJson = "),
    slice(storefront, "const writeStorefrontStorage = (key, value)", "const normalizeStorefrontItem"),
    slice(storefront, "const LAST_CHECKOUT_KEY = ", "\n// The store's WhatsApp number"),
    "return { readLastCheckoutDetails, writeLastCheckoutDetails, clearLastCheckoutDetails, LAST_CHECKOUT_KEY, CHECKOUT_ADDRESS_FIELDS, store };",
  ].join("\n");
  const window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
  // eslint-disable-next-line no-new-func
  return new Function("window", "store", source)(window, store);
};

const filledForm = {
  full_name: "  مجدي حلال  ",
  primary_phone: "01012345678",
  email: "buyer@example.com",
  secondary_phone: "01112223333",
  governorate: "الاسكندريه",
  city_area: "ابو يوسف",
  detailed_address: "شارع النصر",
  street_address: "شارع النصر",
  building_number: "14",
  floor_number: "3",
  apartment_number: "7",
  landmark: "جنب الصيدلية",
  delivery_notes: "اتصل قبل التسليم",
  governorate_id: "",
  city_id: "",
  area_id: "",
  zone_id: "",
  district_id: "",
  shipping_city_id: "1",
  shipping_zone_id: "2",
  shipping_district_id: "3",
  city: "الاسكندريه",
  area: "",
  zone: "ابو يوسف",
  district: "ابو يوسف",
  // Never the customer's business: the order's own fields must not ride along.
  payment_method: "cod",
  coupon: "SUMMER",
  order_notes: "هدية",
};

test("the order a device placed comes back as a filled checkout, ids included", () => {
  const memory = loadDeviceMemory();
  memory.writeLastCheckoutDetails(filledForm, { primary_phone: "01012345678", email: "buyer@example.com" });

  const saved = memory.readLastCheckoutDetails();
  // The Bosta ids are what the governorate → zone → district pickers replay; an address
  // saved without them is text the pickers cannot select, so the shipping fee never quotes.
  assert.equal(saved.shipping_city_id, "1");
  assert.equal(saved.shipping_zone_id, "2");
  assert.equal(saved.shipping_district_id, "3");
  memory.CHECKOUT_ADDRESS_FIELDS.forEach((field) => {
    assert.equal(saved[field], String(filledForm[field]).trim(), `${field} is not remembered`);
  });
  assert.equal(saved.full_name, "مجدي حلال");
  assert.equal(saved.secondary_phone, "01112223333");
  assert.equal(saved.email, "buyer@example.com");
  // The cart's own choices belong to that order, not to the next one.
  assert.equal("coupon" in saved, false);
  assert.equal("payment_method" in saved, false);
  assert.equal("order_notes" in saved, false);
});

test("an address old enough to have been moved out of is not offered", () => {
  const memory = loadDeviceMemory();
  memory.writeLastCheckoutDetails(filledForm);
  const stored = JSON.parse(memory.store.get(memory.LAST_CHECKOUT_KEY));

  const atAge = (days) => {
    memory.store.set(memory.LAST_CHECKOUT_KEY, JSON.stringify({ ...stored, saved_at: Date.now() - days * 24 * 60 * 60 * 1000 }));
    return memory.readLastCheckoutDetails();
  };
  assert.ok(atAge(179), "an address from this year still fills the form");
  assert.equal(atAge(181), null);

  // Anything that is not a snapshot this code wrote fills nothing at all.
  memory.store.set(memory.LAST_CHECKOUT_KEY, JSON.stringify({ ...stored, saved_at: 0 }));
  assert.equal(memory.readLastCheckoutDetails(), null);
  memory.store.set(memory.LAST_CHECKOUT_KEY, "not json");
  assert.equal(memory.readLastCheckoutDetails(), null);
  memory.store.set(memory.LAST_CHECKOUT_KEY, JSON.stringify(["an", "array"]));
  assert.equal(memory.readLastCheckoutDetails(), null);
});

test("signing out takes the remembered address with it", () => {
  const memory = loadDeviceMemory();
  memory.writeLastCheckoutDetails(filledForm);
  memory.clearLastCheckoutDetails();
  assert.equal(memory.readLastCheckoutDetails(), null);

  // The account page clears identity storage on its own; the address has to go with the
  // profile, or the next person to use the browser is handed someone's home address.
  const signOut = slice(accountPage, "const clearAccountIdentityStorage = ", "const initialOf");
  assert.match(signOut, /removeItem\(STOREFRONT_PROFILE_KEY\)/);
  assert.match(signOut, /removeItem\(STOREFRONT_LAST_CHECKOUT_KEY\)/);
  assert.match(accountPage, /const STOREFRONT_LAST_CHECKOUT_KEY = "storefront\.checkout\.lastDetails"/);
  assert.match(storefront, /const LAST_CHECKOUT_KEY = "storefront\.checkout\.lastDetails"/);
});

test("the snapshot is written when the order goes through, and the restore never overwrites typing", () => {
  // Written from the form that was actually submitted, beside the profile the page already keeps.
  assert.match(storefront, /writeLastCheckoutDetails\(form, \{ primary_phone: cleanPhone, email: form\.email\.trim\(\)\.toLowerCase\(\) \}\);\s*\n\s*setProfile\(\{/);

  const restore = slice(storefront, "if (deviceAddressRestoredRef.current) return;", "const chooseSavedAddress");
  // `force` would wipe a field the customer already typed; the device copy is only an offer.
  assert.equal(/force:\s*true/.test(restore), false);
  assert.match(restore, /restoreAddressCandidate\(saved, \{ lookupKey: "device:last-order" \}\)/);
  // A signed-in customer's server addresses follow them to any device, so they win.
  assert.match(restore, /if \(savedAddresses\.length\) \{/);
  assert.match(restore, /latestAddressRestore\.status === "restoring"/);
  // Replaying a Bosta id into a picker that has not loaded drops the restore silently.
  assert.match(restore, /!bostaCityOptions\.length/);

  // "Use a new address" means this one is wrong: it must not come back on the next visit.
  const newAddress = slice(storefront, "const startNewAddress = useCallback", "setManualCityArea(false);");
  assert.match(newAddress, /clearLastCheckoutDetails\(\)/);
});
