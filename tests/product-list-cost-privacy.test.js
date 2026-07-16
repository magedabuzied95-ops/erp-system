import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/modules/products/pages/ProductsList.jsx", "utf8");

test("authorized product costs remain concealed until explicitly revealed", () => {
  assert.match(source, /function PriceLine\([\s\S]*?concealed = false[\s\S]*?const \[revealed, setRevealed\] = useState\(false\)/);
  assert.match(source, /revealed \? value : "••••••"/);
  assert.match(source, /aria-pressed=\{revealed\}/);
  assert.match(source, /concealed=\{canViewCostPrice\}/);
  assert.match(source, /concealCost=\{canViewCostPrice\}/);
  assert.match(source, /concealed=\{concealCost\}/);
});

test("unauthorized users still receive the permission-safe placeholder", () => {
  assert.match(source, /const displayCost = canViewCostPrice \? formatCardPrice\(row\.display_cost \?\? 0\) : "—";/);
});
