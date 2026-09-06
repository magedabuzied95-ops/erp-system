import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../src/modules/products/pages/CreateProduct.jsx", import.meta.url);

const countOf = (source, needle) => source.split(needle).length - 1;

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
  const source = await readFile(pageUrl, "utf8");

  for (const [label, marker] of [
    ["storefront visibility", `updateColorGroup(group.id, "is_storefront_visible"`],
    ["thermal on save", `updateColorGroup(group.id, "generate_thermal_artwork"`],
  ]) {
    const at = source.indexOf(marker);
    assert.ok(at > 0, `${label} control should be findable`);
    // The whole row is the accordion trigger, so each control has to swallow the click.
    // Scope the check to THIS button — a neighbour's stopPropagation must not cover for it.
    const buttonStart = source.lastIndexOf("<button", at);
    assert.ok(buttonStart > 0, `${label} control should sit inside a button`);
    const handler = source.slice(buttonStart, at);
    assert.ok(
      handler.includes("event.stopPropagation();"),
      `${label} must stop the click from toggling the panel`
    );
  }
});
