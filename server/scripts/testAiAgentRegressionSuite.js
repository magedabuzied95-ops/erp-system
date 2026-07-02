import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executeAiRegressionMessageTest } from "../routes/aiRegressionHarness.js";
import { buildAiAgentRegressionExtraScenarios } from "./aiAgentRegressionScenarios.extra.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, "fixtures", "aiAgentRegressionScenarios.json");
const reportsDir = path.join(__dirname, "..", "reports");
const jsonReportPath = path.join(reportsDir, "ai-agent-regression-report.json");
const mdReportPath = path.join(reportsDir, "ai-agent-regression-report.md");

const text = (value = "") => String(value ?? "");
const toLower = (value = "") => text(value).toLowerCase();

const getPathValue = (object, pathExpression = "") => {
  if (!pathExpression) return object;
  return String(pathExpression)
    .split(".")
    .reduce((value, key) => (value == null ? undefined : value[key]), object);
};

const compare = ({ actual, op, expected }) => {
  switch (op) {
    case "eq":
      return Object.is(actual, expected);
    case "ne":
      return !Object.is(actual, expected);
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !Boolean(actual);
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "notExists":
      return actual === undefined || actual === null || actual === "";
    case "includes": {
      if (Array.isArray(actual)) return actual.some((item) => Object.is(item, expected) || text(item) === text(expected));
      return toLower(actual).includes(toLower(expected));
    }
    case "notIncludes": {
      if (Array.isArray(actual)) return !actual.some((item) => Object.is(item, expected) || text(item) === text(expected));
      return !toLower(actual).includes(toLower(expected));
    }
    case "anyIncludes": {
      const expectedList = Array.isArray(expected) ? expected : [expected];
      const haystack = Array.isArray(actual) ? actual.map(text).join(" ") : text(actual);
      return expectedList.some((item) => haystack.toLowerCase().includes(text(item).toLowerCase()));
    }
    case "arrayIncludes":
      return Array.isArray(actual) && actual.some((item) => Object.is(item, expected) || text(item) === text(expected));
    case "arrayNotIncludes":
      return !Array.isArray(actual) || !actual.some((item) => Object.is(item, expected) || text(item) === text(expected));
    default:
      throw new Error(`Unsupported assertion op: ${op}`);
  }
};

const formatValue = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return text(value);
};

const loadScenarios = async () => {
  const raw = await readFile(fixturePath, "utf8");
  const base = JSON.parse(raw);
  const extras = buildAiAgentRegressionExtraScenarios();
  return {
    scenarios: [...(base.scenarios || []), ...extras],
  };
};

const expandRuns = (scenarios = []) =>
  scenarios.flatMap((scenario) => {
    const channels = Array.isArray(scenario.channels) && scenario.channels.length
      ? scenario.channels
      : [scenario.channel || "web_chat"];
    return channels.map((channel) => ({
      ...scenario,
      channel,
      run_id: channels.length > 1 ? `${scenario.id}:${channel}` : scenario.id,
    }));
  });

const inferGroup = (scenario = {}) =>
  scenario.group ||
  scenario.batch ||
  (scenario.id?.startsWith("search-") ? "Product Search" :
    scenario.id?.startsWith("alternative-") ? "Alternatives" :
    scenario.id?.startsWith("size-") || scenario.id?.startsWith("stock-") ? "Stock Truth" :
    scenario.id?.startsWith("order-") ? "Order Flow" :
    scenario.id?.startsWith("memory-") ? "Memory" :
    scenario.id?.startsWith("human-") || scenario.id?.startsWith("global-") || scenario.id?.startsWith("safety-") ? "Safety / Controls" :
    "General");

const inferSeverity = (scenario = {}) => {
  const group = inferGroup(scenario);
  if (scenario.severity) return scenario.severity;
  if (group === "Safety / Controls") return "critical";
  if (group === "Stock Truth") return "critical";
  if (group === "Order Flow") return "high";
  if (group === "Memory") return "high";
  if (group === "Alternatives") return "medium";
  return "medium";
};

const buildBody = ({ scenario = {}, step = {}, channel = "" } = {}) => ({
  tenant_id: scenario.tenantId || 1,
  channel: step.input?.channel || scenario.channel || channel || "web_chat",
  conversationId: step.input?.conversationId || scenario.conversationId || scenario.run_id || scenario.id || "",
  message: step.input?.message || "",
  product_query: step.input?.product_query || "",
  intent: step.input?.intent || "",
  metadata: {
    ...(scenario.metadata || {}),
    ...(step.input?.metadata || {}),
    channel: step.input?.channel || scenario.channel || channel || "web_chat",
    conversation_id: step.input?.conversationId || scenario.conversationId || scenario.run_id || scenario.id || "",
  },
  ...(step.input && Object.prototype.hasOwnProperty.call(step.input, "memory") ? { memory: step.input.memory } : {}),
  ...(Array.isArray(step.input?.product_cards) && step.input.product_cards.length ? { product_cards: step.input.product_cards } : {}),
  ...(step.input?.fixture ? { fixture: step.input.fixture } : {}),
});

const runStep = async ({ scenario = {}, step = {}, stepIndex = 0, channel = "" } = {}) => {
  const body = buildBody({ scenario, step, channel });
  const result = await executeAiRegressionMessageTest({ body, source: "ai_agent_regression_suite" });
  const response = result?.body || {};
  const assertions = [];
  for (const assertion of step.assertions || []) {
    const actual = getPathValue(response, assertion.path);
    let passed = false;
    let error = "";
    try {
      passed = compare({ actual, op: assertion.op, expected: assertion.value });
    } catch (compareError) {
      error = compareError?.message || String(compareError);
    }
    assertions.push({
      ...assertion,
      actual,
      passed,
      error,
    });
  }
  return {
    step_index: stepIndex,
    input: body,
    status: result?.status ?? 0,
    response,
    assertions,
    passed: assertions.every((item) => item.passed),
  };
};

const runScenario = async (scenario = {}) => {
  const steps = [];
  const messageSteps = Array.isArray(scenario.messages) ? scenario.messages : [];
  for (let i = 0; i < messageSteps.length; i += 1) {
    steps.push(await runStep({ scenario, step: messageSteps[i], stepIndex: i, channel: scenario.channel || "web_chat" }));
  }
  return {
    id: scenario.id,
    title: scenario.title,
    tenantId: scenario.tenantId || 1,
    channel: scenario.channel || "web_chat",
    run_id: scenario.run_id || scenario.id,
    group: inferGroup(scenario),
    severity: inferSeverity(scenario),
    steps,
    passed: steps.every((step) => step.passed),
  };
};

const buildSummary = (results = []) => {
  const flattened = results.flatMap((scenario) => scenario.steps.map((step) => ({
    scenario_id: scenario.id,
    scenario_title: scenario.title,
    run_id: scenario.run_id,
    channel: scenario.channel,
    step_index: step.step_index,
    passed: step.passed,
    assertions: step.assertions,
    response: step.response,
  })));
  const failedAssertions = flattened.flatMap((item) =>
    item.assertions.filter((assertion) => !assertion.passed).map((assertion) => ({
      scenario_id: item.scenario_id,
      scenario_title: item.scenario_title,
      run_id: item.run_id,
      channel: item.channel,
      step_index: item.step_index,
      path: assertion.path,
      op: assertion.op,
      expected: assertion.value,
      actual: assertion.actual,
      error: assertion.error,
    }))
  );
  const overallPassRate = results.length ? results.filter((scenario) => scenario.passed).length / results.length : 1;
  const groupSummaryMap = new Map();
  const channelSummaryMap = new Map();
  const severitySummaryMap = new Map();
  for (const scenario of results) {
    const groupKey = inferGroup(scenario);
    const channelKey = scenario.channel || "web_chat";
    const severityKey = inferSeverity(scenario);
    const bump = (map, key) => {
      const entry = map.get(key) || { total: 0, passed: 0, failed: 0 };
      entry.total += 1;
      if (scenario.passed) entry.passed += 1; else entry.failed += 1;
      map.set(key, entry);
    };
    bump(groupSummaryMap, groupKey);
    bump(channelSummaryMap, channelKey);
    bump(severitySummaryMap, severityKey);
  }
  const toSummaryObject = (map) => Object.fromEntries([...map.entries()].map(([key, value]) => [key, { ...value, pass_rate: value.total ? value.passed / value.total : 1 }]));
  const groupSummary = toSummaryObject(groupSummaryMap);
  const channelSummary = toSummaryObject(channelSummaryMap);
  const severitySummary = toSummaryObject(severitySummaryMap);
  const topFailedAreas = [...groupSummaryMap.entries()]
    .map(([area, value]) => ({ area, failures: value.failed }))
    .filter((entry) => entry.failures > 0)
    .sort((left, right) => right.failures - left.failures)
    .slice(0, 10);
  const criticalFailures = results.filter((scenario) => inferSeverity(scenario) === "critical" && !scenario.passed).length;
  const safetyPassRate = (groupSummary["Safety / Controls"]?.pass_rate ?? 1);
  const stockTruthPassRate = (groupSummary["Stock Truth"]?.pass_rate ?? 1);
  const readinessDecision = criticalFailures === 0 && safetyPassRate === 1 && stockTruthPassRate === 1 && overallPassRate >= 0.95 ? "YES" : "NO";
  return {
    total_scenarios: results.length,
    passed_scenarios: results.filter((scenario) => scenario.passed).length,
    failed_scenarios: results.filter((scenario) => !scenario.passed).length,
    overall_pass_rate: overallPassRate,
    total_steps: flattened.length,
    passed_steps: flattened.filter((step) => step.passed).length,
    failed_steps: flattened.filter((step) => !step.passed).length,
    failed_assertions: failedAssertions.length,
    first_10_failures: failedAssertions.slice(0, 10),
    group_summary: groupSummary,
    channel_summary: channelSummary,
    severity_summary: severitySummary,
    top_failed_areas: topFailedAreas,
    readiness_decision: readinessDecision,
    readiness_checks: {
      critical_failures: criticalFailures,
      safety_controls_pass_rate: safetyPassRate,
      stock_truth_pass_rate: stockTruthPassRate,
      overall_pass_rate: overallPassRate,
    },
  };
};

const renderMarkdown = ({ summary = {}, results = [] } = {}) => {
  const lines = [];
  lines.push("# AI Agent Regression Report");
  lines.push("");
  lines.push(`- Total scenarios: ${summary.total_scenarios || 0}`);
  lines.push(`- Passed scenarios: ${summary.passed_scenarios || 0}`);
  lines.push(`- Failed scenarios: ${summary.failed_scenarios || 0}`);
  lines.push(`- Total steps: ${summary.total_steps || 0}`);
  lines.push(`- Failed assertions: ${summary.failed_assertions || 0}`);
  lines.push(`- Overall pass rate: ${((summary.overall_pass_rate || 0) * 100).toFixed(1)}%`);
  lines.push(`- Ready for production: ${summary.readiness_decision || "NO"}`);
  lines.push("");
  lines.push("## Scenario Summary");
  lines.push("| Scenario | Channel | Status | Steps |");
  lines.push("| --- | --- | --- | --- |");
  for (const scenario of results) {
    lines.push(`| ${scenario.title} | ${scenario.channel} | ${scenario.passed ? "PASS" : "FAIL"} | ${scenario.steps.length} |`);
  }
  lines.push("");
  lines.push("## Group Summary");
  lines.push("| Group | Pass Rate | Total | Passed | Failed |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [group, value] of Object.entries(summary.group_summary || {})) {
    lines.push(`| ${group} | ${(value.pass_rate * 100).toFixed(1)}% | ${value.total} | ${value.passed} | ${value.failed} |`);
  }
  lines.push("");
  lines.push("## Channel Summary");
  lines.push("| Channel | Pass Rate | Total | Passed | Failed |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [channel, value] of Object.entries(summary.channel_summary || {})) {
    lines.push(`| ${channel} | ${(value.pass_rate * 100).toFixed(1)}% | ${value.total} | ${value.passed} | ${value.failed} |`);
  }
  lines.push("");
  lines.push("## Severity Summary");
  lines.push("| Severity | Pass Rate | Total | Passed | Failed |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [severity, value] of Object.entries(summary.severity_summary || {})) {
    lines.push(`| ${severity} | ${(value.pass_rate * 100).toFixed(1)}% | ${value.total} | ${value.passed} | ${value.failed} |`);
  }
  lines.push("");
  lines.push("## Top Failed Areas");
  const topFailedAreas = summary.top_failed_areas || [];
  if (!topFailedAreas.length) {
    lines.push("No failed areas.");
  } else {
    topFailedAreas.forEach((area, index) => {
      lines.push(`${index + 1}. ${area.area}: ${area.failures}`);
    });
  }
  lines.push("");
  lines.push("## Failures");
  const failures = summary.first_10_failures || [];
  if (!failures.length) {
    lines.push("No failures.");
  } else {
    failures.forEach((failure, index) => {
      lines.push(`${index + 1}. ${failure.scenario_id} [step ${failure.step_index}] ${failure.path} ${failure.op} expected ${formatValue(failure.expected)} actual ${formatValue(failure.actual)}`);
    });
  }
  return lines.join("\n");
};

const main = async () => {
  const { scenarios } = await loadScenarios();
  const runs = expandRuns(scenarios);
  const results = [];
  const startedAt = new Date().toISOString();

  for (const scenario of runs) {
    const scenarioResult = await runScenario(scenario);
    results.push(scenarioResult);
  }

  const summary = buildSummary(results);
  const finishedAt = new Date().toISOString();
  const report = {
    started_at: startedAt,
    finished_at: finishedAt,
    fixture_path: path.relative(process.cwd(), fixturePath),
    summary,
    results,
  };

  await mkdir(reportsDir, { recursive: true });
  await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdReportPath, `${renderMarkdown({ summary, results })}\n`, "utf8");

  console.log("AI Agent Regression Suite");
  console.log(`Scenarios: ${summary.total_scenarios}  Passed: ${summary.passed_scenarios}  Failed: ${summary.failed_scenarios}`);
  console.log(`Steps: ${summary.total_steps}  Failed assertions: ${summary.failed_assertions}`);
  console.log(`Overall pass rate: ${((summary.overall_pass_rate || 0) * 100).toFixed(1)}%`);
  console.log(`Ready for production: ${summary.readiness_decision || "NO"}`);
  if (summary.first_10_failures.length) {
    console.log("First 10 failures:");
    summary.first_10_failures.forEach((failure, index) => {
      console.log(`${index + 1}. ${failure.scenario_id} [step ${failure.step_index}] ${failure.path} ${failure.op} expected ${formatValue(failure.expected)} actual ${formatValue(failure.actual)}`);
    });
  }

  if (summary.failed_assertions > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
