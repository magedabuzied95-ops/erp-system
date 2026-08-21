import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { before } from "node:test";

import i18next from "i18next";

import { ANALYSIS_LABEL_GROUPS, analysisLabelKey, translateAnalysisLabel, translateAnalysisLabels } from "../src/modules/aiSupport/lib/analysisLabels.js";

const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));
const panel = readFileSync("src/modules/aiSupport/components/AIInboxAnalysisPanel.jsx", "utf8");
const types = readFileSync("src/modules/aiSupport/intelligence/conversationTypes.ts", "utf8");

/*
 * The analysis panel renders verdicts the engines produce in canonical English.
 * The panel chrome was translated; the verdicts were not, so enabling the layer
 * in an Arabic shop showed an Arabic frame full of "Price Sensitive" and
 * "Ready To Buy". These tests keep that from coming back one rule at a time.
 */

let instance;

before(async () => {
  instance = i18next.createInstance();
  await instance.init({
    lng: "ar",
    fallbackLng: "en",
    supportedLngs: ["ar", "en"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    resources: { ar: { translation: { aiSupport: ar } }, en: { translation: { aiSupport: en } } },
  });
});

test("every label the engines can emit is translated in both locales", () => {
  const missing = [];
  for (const [group, labels] of Object.entries(ANALYSIS_LABEL_GROUPS)) {
    for (const label of labels) {
      const key = analysisLabelKey(group, label).replace(/^aiSupport\./, "");
      const path = key.split(".");
      for (const [locale, bundle] of [["en", en], ["ar", ar]]) {
        const value = path.reduce((node, part) => (node == null ? undefined : node[part]), bundle);
        if (!value) missing.push(`${locale}: ${group}.${label}`);
      }
    }
  }
  assert.deepEqual(missing, [], `untranslated analysis labels:\n- ${missing.join("\n- ")}`);
});

test("the mirrored label sets match the engines' own type definitions", () => {
  // ANALYSIS_LABEL_GROUPS is a copy. If conversationTypes gains a mood or a
  // sales stage and the copy does not, the new value renders untranslated and
  // nothing else notices.
  const union = (name) => {
    const line = types.split("\n").find((row) => row.startsWith(`export type ${name} =`)) || "";
    return [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  };
  assert.deepEqual(ANALYSIS_LABEL_GROUPS.mood, union("CustomerMood"));
  assert.deepEqual(ANALYSIS_LABEL_GROUPS.priority, union("Priority"));
  assert.deepEqual(ANALYSIS_LABEL_GROUPS.stage, union("SalesStage"));
});

test("the mirrored intents, signals and objections match the live rule tables", async () => {
  // These come from regex tables rather than a type union, so they are read from
  // the module the analyser actually uses.
  const { createServer } = await import("vite");
  const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  try {
    const rules = await server.ssrLoadModule("/src/modules/aiSupport/intelligence/conversationRules.ts");
    assert.deepEqual(ANALYSIS_LABEL_GROUPS.intent, rules.INTENT_PATTERNS.map(([label]) => label));
    assert.deepEqual(ANALYSIS_LABEL_GROUPS.signal, rules.BUYING_SIGNAL_PATTERNS.map(([label]) => label));
    assert.deepEqual(ANALYSIS_LABEL_GROUPS.objection, rules.OBJECTION_PATTERNS.map(([label]) => label));
  } finally {
    await server.close();
  }
});

test("an Arabic operator sees Arabic verdicts", () => {
  const t = instance.t.bind(instance);
  assert.equal(translateAnalysisLabel(t, "mood", "Price Sensitive"), "حساس للسعر");
  assert.equal(translateAnalysisLabel(t, "stage", "Ready To Buy"), "جاهز للشراء");
  assert.equal(translateAnalysisLabel(t, "priority", "Critical"), "حرجة");
  assert.deepEqual(translateAnalysisLabels(t, "intent", ["Complaint", "Delivery"]), ["شكوى", "التوصيل"]);
  // No Latin script leaks through on the values an operator reads most.
  for (const group of ["mood", "priority", "stage", "intent", "signal", "objection"]) {
    for (const label of ANALYSIS_LABEL_GROUPS[group]) {
      const rendered = translateAnalysisLabel(t, group, label);
      assert.doesNotMatch(rendered, /[A-Za-z]/, `ar ${group}.${label} rendered "${rendered}"`);
    }
  }
});

test("an unknown label degrades to the raw English, never to a key", () => {
  // A new rule should look untranslated, not broken.
  const t = instance.t.bind(instance);
  assert.equal(translateAnalysisLabel(t, "intent", "Warranty Claim"), "Warranty Claim");
  assert.equal(translateAnalysisLabel(t, "mood", ""), "");
  assert.deepEqual(translateAnalysisLabels(t, "intent", null), []);
});

test("the panel renders no untranslated engine verdict", () => {
  // Each of these used to be interpolated raw.
  assert.match(panel, /translateAnalysisLabels\(t, "intent", intelligence\.intent\)/);
  assert.match(panel, /translateAnalysisLabel\(t, "mood", intelligence\.customerMood\)/);
  assert.match(panel, /translateAnalysisLabel\(t, "priority", intelligence\.priority\)/);
  assert.match(panel, /translateAnalysisLabel\(t, "stage", intelligence\.salesStage\)/);
  assert.match(panel, /translateAnalysisLabel\(t, "signal", signal\)/);
  assert.match(panel, /translateAnalysisLabel\(t, "objection", objection\)/);
  assert.doesNotMatch(panel, /\{intelligence\.customerMood\}/);
  assert.doesNotMatch(panel, /\{intelligence\.priority\}/);
  assert.doesNotMatch(panel, /intelligence\.intent\.join/);
});
