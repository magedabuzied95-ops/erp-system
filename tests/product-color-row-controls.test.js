import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../src/modules/products/pages/CreateProduct.jsx", import.meta.url);
const editPageUrl = new URL("../src/modules/products/pages/ProductEdit.jsx", import.meta.url);

const countOf = (source, needle) => source.split(needle).length - 1;

const ROW_CONTROLS = [
  ["storefront visibility", `updateColorGroup(group.id, "is_storefront_visible"`],
  ["thermal on save", `updateColorGroup(group.id, "generate_thermal_artwork"`],
];

// Every control on the colour row has to swallow its own click — the row itself is the
// accordion trigger, so a neighbour's stopPropagation must not be allowed to cover for it.
const assertRowControlsSwallowClicks = (source, page) => {
  for (const [label, marker] of ROW_CONTROLS) {
    const at = source.indexOf(marker);
    assert.ok(at > 0, `${page}: ${label} control should be findable`);
    const buttonStart = source.lastIndexOf("<button", at);
    assert.ok(buttonStart > 0, `${page}: ${label} control should sit inside a button`);
    assert.ok(
      source.slice(buttonStart, at).includes("event.stopPropagation();"),
      `${page}: ${label} must stop the click from toggling the panel`
    );
  }
};

test("colour visibility and Thermal-on-save sit on the collapsed colour row, not inside the panel", async () => {
  const source = await readFile(pageUrl, "utf8");

  const rowStart = source.indexOf("aria-label={`اسحب لترتيب ${group.color");
  const panelStart = source.indexOf("{isExpanded ? (", rowStart);
  assert.ok(rowStart > 0, "the colour row drag handle should still be findable");
  assert.ok(panelStart > rowStart, "the expanded panel should still follow the row");
  const rowHeader = source.slice(rowStart, panelStart);

  assert.ok(
    rowHeader.includes(`updateColorGroup(group.id, "is_storefront_visible", group.is_storefront_visible === false)`),
    "the storefront-visibility toggle must live on the row, like the product edit page"
  );
  assert.ok(
    rowHeader.includes(`updateColorGroup(group.id, "generate_thermal_artwork", !group.generate_thermal_artwork)`),
    "the Thermal-on-save toggle must live on the row, like the product edit page"
  );

  // One switch per setting. A second copy inside the panel is how a colour ends up
  // hidden on the site while the other control still reads "visible".
  assert.equal(
    countOf(source, `updateColorGroup(group.id, "is_storefront_visible"`),
    1,
    "there must be exactly one storefront-visibility control"
  );
  assert.equal(
    countOf(source, `updateColorGroup(group.id, "generate_thermal_artwork"`),
    1,
    "there must be exactly one Thermal-on-save control"
  );
});

test("the row controls do not open or close the colour panel when clicked", async () => {
  assertRowControlsSwallowClicks(await readFile(pageUrl, "utf8"), "create product");
  assertRowControlsSwallowClicks(await readFile(editPageUrl, "utf8"), "edit product");
});
