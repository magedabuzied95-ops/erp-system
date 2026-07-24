import test from "node:test";
import assert from "node:assert/strict";

test("storefront category posters stay on the frontend origin", async () => {
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
    const { resolveProductImageUrl } = await import(`../src/shared/lib/imageUrls.js?poster-origin=${Date.now()}`);
    assert.equal(
      resolveProductImageUrl("/storefront/category-posters/men.webp"),
      "https://m1store-egy.com/storefront/category-posters/men.webp"
    );
    assert.equal(
      resolveProductImageUrl("/uploads/products/example.webp"),
      "http://m1store-egy.com:8000/uploads/products/example.webp"
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
