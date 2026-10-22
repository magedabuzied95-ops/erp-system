import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const RANKING_COLUMNS = ["quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking"];

// managerApi.js imports a Vite-resolved path, so the column model is read from its source.
const levelColumns = () => {
  const source = read("../../src/modules/metaAds/manager/list/managerApi.js");
  const block = source.match(/export const LEVEL_COLUMNS = \{([\s\S]*?)\n\};/)[1];
  const line = (level) => block.match(new RegExp(`${level}: \\[([^\\]]*)\\]`))[1];
  return { campaign: line("campaign"), adset: line("adset"), ad: line("ad") };
};

// Meta fills the rankings for ads only; the list offers them there and nowhere else.
test("the rankings are ad-level columns, with a label in both languages", () => {
  const columns = levelColumns();
  assert.match(columns.ad, /\.\.\.RANKING_COLUMNS/);
  assert.doesNotMatch(columns.campaign, /RANKING_COLUMNS/);
  assert.doesNotMatch(columns.adset, /RANKING_COLUMNS/);
  for (const level of ["campaign", "adset", "ad"]) assert.match(columns[level], /"frequency"/, `${level} frequency`);
  for (const locale of ["ar", "en"]) {
    const dictionary = JSON.parse(read(`../../src/locales/${locale}/metaAdsManager.json`));
    for (const column of [...RANKING_COLUMNS, "frequency"]) assert.ok(dictionary.columns[column], `${locale} ${column}`);
    for (const code of ["ABOVE_AVERAGE", "AVERAGE", "BELOW_AVERAGE_35", "BELOW_AVERAGE_20", "BELOW_AVERAGE_10"]) {
      assert.ok(dictionary.rankings[code], `${locale} ${code}`);
    }
    assert.ok(dictionary.columnPresets.quality, `${locale} quality preset`);
  }
});

// Mutation guards: the sync asks for and stores the three rankings; the list reads the newest
// day's verdict rather than summing text.
test("the sync stores the rankings and the list reads the newest verdict", () => {
  const core = read("../../server/modules/metaAds/metaAdsCore.js");
  assert.match(core, /const INSIGHT_FIELDS = "[^"]*quality_ranking,engagement_rate_ranking,conversion_rate_ranking[^"]*"/);
  for (const column of RANKING_COLUMNS) assert.match(core, new RegExp(`${column} = EXCLUDED\\.${column}`), column);
  const data = read("../../server/modules/metaAds/manager/list/managerData.js");
  for (const column of RANKING_COLUMNS) {
    assert.match(data, new RegExp(`\\(ARRAY_AGG\\(i\\.${column} ORDER BY i\\.date_start DESC\\) FILTER \\(WHERE i\\.${column} IS NOT NULL\\)\\)\\[1\\] AS ${column}`), column);
  }
  assert.match(data, /SUM\(i\.impressions\)::float \/ SUM\(i\.reach\) END AS frequency/);
  const schema = read("../../server/modules/metaAds/metaAdsSchema.js");
  for (const column of RANKING_COLUMNS) assert.match(schema, new RegExp(`ALTER TABLE meta_ads_insights ADD COLUMN IF NOT EXISTS ${column} TEXT NULL`), column);
});
