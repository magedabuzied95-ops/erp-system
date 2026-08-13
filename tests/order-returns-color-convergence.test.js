import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const returnsPageSource = fs.readFileSync(
  new URL("../src/modules/orders/pages/OrderReturnsPage.jsx", import.meta.url),
  "utf8"
);

test("order returns surfaces follow the shared M1 light and dark theme tokens", () => {
  const fixedDarkUtilities = [
    "bg-zinc-950",
    "border-white/10",
    "bg-white/5",
    "bg-white/[",
    "text-zinc-",
  ];

  for (const utility of fixedDarkUtilities) {
    assert.equal(
      returnsPageSource.includes(utility),
      false,
      `OrderReturnsPage must not reintroduce fixed-dark utility: ${utility}`
    );
  }

  for (const token of [
    "bg-[var(--surface)]",
    "bg-[var(--card)]",
    "border-[var(--border)]",
    "text-[var(--text)]",
    "text-[var(--muted)]",
  ]) {
    assert.ok(returnsPageSource.includes(token), `OrderReturnsPage must use ${token}`);
  }
});

test("order returns keeps semantic status contrast in both themes", () => {
  assert.match(returnsPageSource, /text-emerald-700[^\n]*dark:text-emerald-200/);
  assert.match(returnsPageSource, /text-amber-700[^\n]*dark:text-amber-200/);
  assert.match(returnsPageSource, /text-rose-700[^\n]*dark:text-rose-200/);
});
