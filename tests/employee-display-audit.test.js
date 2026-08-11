import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  normalizeDisplayAuditAudiences,
  resolveDisplayAuditColorsForAudience,
} from "../server/services/employeeDisplayAuditService.js";

const source = (path) => fs.readFile(path, "utf8");

test("employee display audit stays independent from display refill alerts", async () => {
  const [service, routes] = await Promise.all([
    source("server/services/employeeDisplayAuditService.js"),
    source("server/routes/employeePortal.js"),
  ]);
  assert.match(service, /is_displayed/);
  assert.match(service, /employee_product_display_states/);
  assert.match(service, /COALESCE\(pv\.stock, 0\) > 0/);
  assert.match(service, /jsonb_agg\(/);
  assert.match(service, /color_group_key/);
  assert.match(routes, /\/:token\/display-audit/);
  assert.doesNotMatch(service, /display_refill_alerts/);
});

test("display audit groups non-empty source and audience sections", async () => {
  const service = await source("server/services/employeeDisplayAuditService.js");
  assert.match(service, /imported_vietnam/);
  assert.match(service, /mirror_original/);
  assert.match(service, /egyptian/);
  assert.match(service, /filter\(\(group\) => group\.count > 0\)/);
  assert.match(service, /filter\(\(section\) => section\.count > 0\)/);
});

test("employee portal updates display audit cards without a page reload", async () => {
  const page = await source("src/modules/employees/pages/EmployeePayrollPortal.jsx");
  assert.match(page, /markDisplayAuditProduct/);
  assert.match(page, /audience: targetAudience/);
  assert.match(page, /display_stage_key: targetStage/);
  assert.match(page, /String\(color\.display_stage_key \|\| ""\) !== targetStage/);
  assert.match(page, /activeTab === "display-audit"/);
});

test("display audit product cards resolve migrated server image paths", async () => {
  const panel = await source("src/modules/employees/components/EmployeeDisplayAuditPanel.jsx");
  assert.match(panel, /import \{ resolveProductImageUrl \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/imageUrls\.js"/);
  assert.match(panel, /const imageUrl = resolveProductImageUrl\(/);
  assert.match(panel, /<img src=\{imageUrl\}/);
  assert.doesNotMatch(panel, /<img src=\{product\.image_url\}/);
});

test("special sizes are an independent audience and start from the smallest qualifying stocked size", () => {
  const variants = [37, 41, 45, 46, 47, 49].map((size, index) => ({
    variant_id: index + 1,
    color_group_key: "wide-range",
    color: "Black",
    size: String(size),
    stock: 1,
  }));
  const special = resolveDisplayAuditColorsForAudience({
    variants,
    audience: "special",
    productGroup: "sneakers",
    productAudiences: ["women", "men"],
  });
  assert.equal(special[0].size, "46");
  assert.equal(special[0].display_stage_key, "special-46-plus");

  const fortySevenOnly = resolveDisplayAuditColorsForAudience({
    variants: [{ variant_id: 1, color_group_key: "only", color: "White", size: "47", stock: 1 }],
    audience: "special",
    productGroup: "sneakers",
    productAudiences: ["men"],
  });
  assert.equal(fortySevenOnly[0].size, "47");
});

test("size 46 alone is not special and special sizes do not apply outside sneakers", () => {
  const variants = [{ variant_id: 1, color_group_key: "only", color: "Black", size: "46", stock: 1 }];
  assert.deepEqual(resolveDisplayAuditColorsForAudience({ variants, audience: "special", productGroup: "sneakers", productAudiences: ["men"] }), []);
  assert.deepEqual(resolveDisplayAuditColorsForAudience({
    variants: [...variants, { variant_id: 2, color_group_key: "only", color: "Black", size: "48", stock: 1 }],
    audience: "special",
    productGroup: "bags",
    productAudiences: ["men"],
  }), []);
});

test("display audit persists each audience and stage independently", async () => {
  const [service, routes, panel] = await Promise.all([
    source("server/services/employeeDisplayAuditService.js"),
    source("server/routes/employeePortal.js"),
    source("src/modules/employees/components/EmployeeDisplayAuditPanel.jsx"),
  ]);
  assert.match(service, /UNIQUE \(product_id, audience_key, display_stage_key\)/);
  assert.match(service, /ON CONFLICT \(product_id, audience_key, display_stage_key\)/);
  assert.match(routes, /audience: req\.body\?\.audience/);
  assert.match(panel, /key: "special", label: "خاص"/);
});

test("display audit exposes product, source, and audience navigation", async () => {
  const [service, panel] = await Promise.all([
    source("server/services/employeeDisplayAuditService.js"),
    source("src/modules/employees/components/EmployeeDisplayAuditPanel.jsx"),
  ]);
  assert.match(service, /product_group_counts/);
  assert.match(service, /normalizeProductGroup/);
  assert.match(panel, /اسنيكرز/);
  assert.match(panel, /كروكس/);
  assert.match(panel, /شنط/);
  assert.match(panel, /شتوي/);
  assert.match(panel, /<select/);
  assert.match(panel, /AUDIENCE_TABS/);
});

test("display audit keeps every model's colors next to each other", async () => {
  const panel = await source("src/modules/employees/components/EmployeeDisplayAuditPanel.jsx");
  assert.match(panel, /orderProductsByModelAndColor/);
  assert.match(panel, /expandModelColors/);
  assert.match(panel, /normalizeModelSortKey\(left\?\.name\)/);
  assert.match(panel, /left\?\.color/);
});

test("multi-audience display models use the smallest stocked size for each audience", () => {
  const audiences = normalizeDisplayAuditAudiences(["kids", "women", "men"]);
  assert.deepEqual(audiences, ["men", "women", "kids"]);
  const variants = [32, 34, 37, 39, 41, 43, 45].map((size, index) => ({
    variant_id: index + 1,
    color_group_key: "same-color",
    color: "Black",
    size: String(size),
    stock: 1,
    audience: "kids,women,men",
  }));
  const base = { variants, productGroup: "sneakers", productAudiences: audiences };
  assert.equal(resolveDisplayAuditColorsForAudience({ ...base, audience: "kids" })[0].size, "32");
  assert.equal(resolveDisplayAuditColorsForAudience({ ...base, audience: "women" })[0].size, "37");
  assert.equal(resolveDisplayAuditColorsForAudience({ ...base, audience: "men" })[0].size, "41");
});

test("kids display models are represented in each stocked size stage", () => {
  const variants = [22, 24, 27, 30, 32, 35].map((size, index) => ({
    variant_id: index + 1,
    color_group_key: "same-color",
    color: "White",
    size: String(size),
    stock: 1,
    audience: "kids",
  }));
  const colors = resolveDisplayAuditColorsForAudience({
    variants,
    audience: "kids",
    productGroup: "sneakers",
    productAudiences: ["kids"],
  });
  assert.deepEqual(colors.map((item) => item.size), ["22", "27", "32"]);
  assert.deepEqual(colors.map((item) => item.display_stage_key), ["kids-22-26", "kids-27-31", "kids-32-36"]);
});
