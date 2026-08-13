/**
 * UI-layer resolver for validation issues produced by workflowGraph.js.
 *
 * workflowGraph is deliberately framework-free and unit-tested on the RAW English
 * `message`, so it never translates. It emits an additive `messageKey` plus
 * `messageParams`, and this helper — which only ever runs in the React layer —
 * turns that into display text.
 *
 * The raw `message` is passed as i18next's defaultValue, so a missing key or a
 * server-produced issue that carries no key still renders its original English
 * rather than a blank line or a raw key path.
 *
 * Accepts a plain string too: server errors mapped onto nodes arrive that way.
 */
export const issueText = (t, issue) => {
  if (typeof issue === "string") return issue;
  if (!issue) return "";
  const raw = issue.message || "";
  if (!issue.messageKey) return raw;
  return t(issue.messageKey, { ...(issue.messageParams || {}), defaultValue: raw });
};
