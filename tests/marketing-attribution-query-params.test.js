import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { __testing } from "../server/services/marketingAttributionAnalyticsService.js";

const { buildOrderFilters, buildEventFilters } = __testing;

/*
 * The rule Postgres enforces on a prepared statement, stated as code: the number of bound values
 * must equal the highest placeholder, and every index up to it must actually appear — an index
 * that is never referenced has no type and is refused too.
 */
const assertPlaceholdersMatch = ({ where, params }, label) => {
  const used = [...where.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const highest = used.length ? Math.max(...used) : 0;
  assert.equal(
    highest,
    params.length,
    `${label}: SQL references up to $${highest} but ${params.length} value(s) are bound`
  );
  for (let index = 1; index <= highest; index += 1) {
    assert.ok(used.includes(index), `${label}: $${index} is bound but never referenced, so it has no type`);
  }
};

const combinations = [];
for (const platform of ["", "all", "facebook"]) {
  for (const from of [null, "2026-09-01"]) {
    for (const to of [null, "2026-09-12"]) {
      combinations.push({ platform, from, to });
    }
  }
}

test("every filter combination binds exactly the values its SQL uses", () => {
  /*
   * The attribution page opens with "all platforms" and no dates. The old builder wrote $2/$3/$4
   * only when those were chosen, while every query always bound four values — so the default view
   * failed with "bind message supplies 4 parameters, but prepared statement requires 1" and the
   * page had never loaded as it opens. Choosing only an end date failed differently: $4 with $2
   * and $3 untyped. Walking all twelve combinations covers both.
   */
  for (const combination of combinations) {
    const label = JSON.stringify(combination);
    assertPlaceholdersMatch(buildOrderFilters({ tenantId: 1, ...combination }), `orders ${label}`);
    assertPlaceholdersMatch(buildEventFilters({ tenantId: 1, ...combination }), `events ${label}`);
  }
});

test("the default view — all platforms, no dates — binds the tenant alone", () => {
  const { where, params } = buildOrderFilters({ tenantId: 7, platform: "all", from: null, to: null });
  assert.deepEqual(params, [7]);
  assert.equal(where, "o.tenant_id = $1::bigint");
});

test("a platform binds once even though the clause reads it twice", () => {
  const { where, params } = buildOrderFilters({ tenantId: 1, platform: "Facebook" });
  assert.deepEqual(params, [1, "facebook"]);
  assert.equal((where.match(/\$2::text/g) || []).length, 2);
});

test("each call returns its own array, so a LIMIT appended to one query cannot shift another", () => {
  // The dashboard runs six of these in parallel and one of them pushes a LIMIT onto its params.
  const first = buildOrderFilters({ tenantId: 1, platform: "facebook", from: "2026-09-01" });
  const second = buildOrderFilters({ tenantId: 1, platform: "facebook", from: "2026-09-01" });
  first.params.push(20);
  assert.equal(second.params.length, 3);
  assert.notEqual(first.params, second.params);
});

test("the campaign query numbers its LIMIT from the params it was actually given", () => {
  // A hard-coded LIMIT $5 only worked when every optional filter happened to be present.
  const source = readFileSync(new URL("../server/services/marketingAttributionAnalyticsService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /LIMIT \$5::int/);
  assert.match(source, /LIMIT \$\{campaignLimit\}::int/);
});
