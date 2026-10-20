// Ads Manager background jobs (automated rules). See ../metaAdsScheduler.js.
import { runAllRules } from "./list/rulesEngine.js";

export const jobs = [
  { name: "meta-ads-rules", everyMinutes: 15, run: runAllRules },
];
