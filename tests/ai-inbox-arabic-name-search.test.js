import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { arabicSearchContainsSql, arabicSearchSql, arabicSearchText } from "../server/utils/arabicSearch.js";

const serviceSource = fs.readFileSync("server/services/aiSalesAgentService.js", "utf8");

const inboxSearchClause = () => {
  const start = serviceSource.indexOf("  if (searchTerm) {");
  assert.ok(start >= 0, "loadAiInbox search clause not found");
  return serviceSource.slice(start, serviceSource.indexOf("\n  if (summaryOnly) {", start));
};

const matches = (name, query) => arabicSearchText(name).includes(arabicSearchText(query));

test("a missing space no longer hides a customer", () => {
  // The same person is stored both ways across the CRM, so each spelling has to
  // find the other or half the customers stay invisible.
  assert.ok(matches("عبد الرحمن اسامة", "عبدالرحمن"));
  assert.ok(matches("عبدالرحمن محمد", "عبد الرحمن"));
  assert.ok(matches("د / عبد الرحمن ناجي", "عبدالرحمن"));
  assert.ok(matches("محمود عبدالرحمن", "عبد الرحمن"));
});

test("hamza, taa marbuta, alef maqsura and tashkeel all fold together", () => {
  assert.ok(matches("أحمد", "احمد"));
  assert.ok(matches("احمد", "أحمد"));
  assert.ok(matches("إسلام", "اسلام"));
  assert.ok(matches("آية", "ايه"));
  assert.ok(matches("فاطمة", "فاطمه"));
  assert.ok(matches("يحيى", "يحيي"));
  assert.ok(matches("مُحَمَّد", "محمد"));
  assert.ok(matches("محـــمد", "محمد"));
});

test("folding does not collapse genuinely different names", () => {
  assert.ok(!matches("عبد الرحمن", "عبد الرحيم"));
  assert.ok(!matches("محمود", "محمد"));
  assert.ok(!matches("سارة", "سامية"));
});

test("latin names and digits survive folding", () => {
  assert.ok(matches("Abdelrahman Osama", "abdelrahman"));
  assert.equal(arabicSearchText("01024960585"), "01024960585");
});

test("the SQL folding expression mirrors the JS one character for character", () => {
  // Both sides of every comparison go through the same expression, so the
  // column and the typed term can never be folded differently.
  const columnSql = arabicSearchSql("c.name");
  const termSql = arabicSearchSql("$2::text");
  const contains = arabicSearchContainsSql("c.name", "$2::text");

  assert.equal(contains, `${columnSql} LIKE '%' || ${termSql} || '%'`);

  // Compare by code point: combining marks are not safe to embed in a literal.
  const translateArgs = (sql) => {
    const match = sql.match(/translate\(LOWER\(COALESCE\(.*?\)::text\), '(.*?)', '(.*?)'\)/);
    assert.ok(match, `no translate() found in: ${sql}`);
    return { from: [...match[1]], to: [...match[2]] };
  };

  for (const sql of [columnSql, termSql]) {
    assert.match(sql, /\[\[:space:\]\[:punct:\]\]/);
    const { from, to } = translateArgs(sql);

    // Every folded carrier maps onto a plain letter...
    assert.deepEqual(from.slice(0, to.length), [..."أإآٱؤئىة"]);
    assert.deepEqual(to, [..."ااااوييه"]);

    // ...and everything past the mapped pairs is dropped by translate(), which
    // must only ever be tatweel and the tashkeel marks.
    for (const character of from.slice(to.length)) {
      const code = character.codePointAt(0);
      const isTatweel = code === 0x0640;
      const isDiacritic = (code >= 0x064b && code <= 0x0652) || code === 0x0653 || code === 0x0654 || code === 0x0655 || code === 0x0670;
      assert.ok(isTatweel || isDiacritic, `unexpected dropped character U+${code.toString(16)}`);
    }
  }

  // The same folding really does run on both sides of the comparison.
  assert.ok(columnSql.includes("c.name") && termSql.includes("$2::text"));
  assert.equal(
    columnSql.replace("c.name", "X"),
    termSql.replace("$2::text", "X")
  );
});

test("the inbox search folds every name column instead of raw LIKE", () => {
  const clause = inboxSearchClause();

  for (const column of [
    "s.customer_name",
    "c.customer_name",
    "p.display_name",
    "p.customer_name",
    "p.first_name",
    "p.last_name",
  ]) {
    assert.ok(clause.includes(`"${column}"`), `search clause dropped ${column}`);
  }
  assert.match(clause, /nameMatches[\s\S]*arabicSearchContainsSql/);
});

test("the inbox searches each message field separately, not through one COALESCE", () => {
  const clause = inboxSearchClause();

  // COALESCE picks the first non-null field and never looks at the rest, so a
  // hit in the last message was unreachable whenever an earlier field was set.
  assert.doesNotMatch(clause, /COALESCE\(m\.customer_message, m\.message_text/);
  for (const column of ["m.customer_message", "m.message_text", "s.last_message", "c.last_message"]) {
    assert.ok(clause.includes(`"${column}"`), `search clause dropped ${column}`);
  }
});

test("the inbox reaches the ERP customer name that the row actually displays", () => {
  const clause = inboxSearchClause();

  // The displayed name is resolved by phone after the query runs, so the search
  // has to walk that join backwards to be able to find it at all.
  assert.match(clause, /loadErpCustomerPhoneKeysByName\(\{ tenantId, searchTerm \}\)/);
  assert.match(clause, /phoneSqlDigits\(column\)\} = ANY\(/);
  assert.match(serviceSource, /const loadErpCustomerPhoneKeysByName = async/);
  assert.match(serviceSource, /FROM customers c\s*\n\s*WHERE \$\{arabicSearchContainsSql/);
});

test("phones and opaque ids keep the plain contains match", () => {
  const clause = inboxSearchClause();
  assert.match(clause, /identifierMatches[\s\S]*"p\.phone",\s*\n\s*"c\.external_customer_id",\s*\n\s*"s\.session_id",/);
  assert.match(clause, /LOWER\(COALESCE\(\$\{column\}, ''\)\) LIKE \$\{likeIdx\}/);
});
