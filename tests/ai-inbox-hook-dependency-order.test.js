import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A hook's dependency array is evaluated the moment the hook call runs, so an
 * identifier listed there that is declared further down the same component body
 * is not a style problem — it is a temporal-dead-zone throw on the first render,
 * and it takes the whole page to the crash screen.
 *
 * ESLint does not catch it (react-hooks/exhaustive-deps checks completeness, not
 * order) and neither does the build. It shipped once: hasMoreConversations was
 * declared beside loadMoreConversations, ~2200 lines below the empty-state memo
 * that depended on it, and /admin/ai-inbox threw "Cannot access
 * 'hasMoreConversations' before initialization" before painting anything.
 *
 * These files are ten thousand lines apiece, so the guard is mechanical.
 */
const componentBody = (file, startsWith) => {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(startsWith));
  assert.ok(start >= 0, `component not found in ${file}: ${startsWith}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^(export\s+)?(default\s+)?(function|const|class)\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { lines, start, end };
};

const dependenciesReadBeforeDeclaration = ({ lines, start, end }) => {
  // Only the component's own top-level bindings can be in the dead zone; two
  // spaces of indent is what tells them from anything nested in a callback.
  const declaredAt = new Map();
  for (let index = start; index < end; index += 1) {
    const declaration = /^\s{2}(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(lines[index]);
    if (declaration && !declaredAt.has(declaration[1])) declaredAt.set(declaration[1], index + 1);
  }
  const findings = [];
  for (let index = start; index < end; index += 1) {
    const deps = /^\s*\},\s*\[(.*)\]\s*\)\s*;?\s*$/.exec(lines[index]);
    if (!deps) continue;
    for (const raw of deps[1].split(",")) {
      const name = raw.trim().split(/[.?[\s]/)[0];
      if (!name || !declaredAt.has(name)) continue;
      if (declaredAt.get(name) > index + 1) {
        findings.push(`line ${index + 1} depends on "${name}", declared at line ${declaredAt.get(name)}`);
      }
    }
  }
  return findings;
};

const SURFACES = [
  ["src/modules/aiSupport/pages/AiInbox.jsx", "export default function AiInbox({ reviewerMode = false })"],
  ["src/modules/aiSupport/pages/AiInboxPwa.jsx", "export default function AiInboxPwa()"],
];

for (const [file, startsWith] of SURFACES) {
  test(`${file} declares every hook dependency before the hook that reads it`, () => {
    const findings = dependenciesReadBeforeDeclaration(componentBody(file, startsWith));
    assert.deepEqual(findings, [], `${file}\n  ${findings.join("\n  ")}`);
  });
}

test("the guard actually catches the shape that shipped", () => {
  // Without this the two tests above would keep passing if the scan silently
  // stopped finding declarations at all.
  const lines = [
    "export default function Demo() {",
    "  const value = useMemo(() => later, [later]);",
    "  const later = true;",
    "}",
  ];
  const findings = dependenciesReadBeforeDeclaration({ lines, start: 0, end: lines.length });
  assert.equal(findings.length, 0, "a single-line hook call is out of scope for this scan");
  const multiline = [
    "export default function Demo() {",
    "  const value = useMemo(() => {",
    "    return later;",
    "  }, [later]);",
    "  const later = true;",
    "}",
  ];
  const caught = dependenciesReadBeforeDeclaration({ lines: multiline, start: 0, end: multiline.length });
  assert.deepEqual(caught, ['line 4 depends on "later", declared at line 5']);
});
