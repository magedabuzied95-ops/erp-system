// Why Meta rejected an ad, in one sentence the table can show. Pure, unit-tested.
//
// Graph returns two shapes on an ad:
//   ad_review_feedback: { global: { "<POLICY>": "<reason text>" },
//                         placement_specific: { facebook: {...}, instagram: {...} } }
//   issues_info:        [{ level, error_code, error_summary, error_message, error_type }]
// The policy keys are Meta's internal names (e.g. "UNACCEPTABLE_BUSINESS_PRACTICES",
// "ADULT_CONTENT"); the reason text is already in the ad account's language.

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

const humanizePolicy = (key = "") => text(key).toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());

const readFeedbackBlock = (block, placement = "") => {
  if (!block || typeof block !== "object") return [];
  return Object.entries(block)
    .filter(([key]) => key !== "placement_specific")
    .map(([policy, reason]) => ({ policy: text(policy), policy_label: humanizePolicy(policy), reason: text(reason), placement }))
    .filter((entry) => entry.policy || entry.reason);
};

export const reviewReasons = (feedback) => {
  if (!feedback || typeof feedback !== "object") return [];
  const reasons = readFeedbackBlock(feedback.global, "");
  const specific = feedback.placement_specific && typeof feedback.placement_specific === "object" ? feedback.placement_specific : {};
  for (const [placement, block] of Object.entries(specific)) reasons.push(...readFeedbackBlock(block, text(placement)));
  // The same policy repeated per placement reads as one reason.
  const seen = new Set();
  return reasons.filter((entry) => {
    const key = `${entry.policy}|${entry.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const issueLines = (issues) =>
  (Array.isArray(issues) ? issues : [])
    .map((issue) => ({
      code: text(issue?.error_code),
      summary: text(issue?.error_summary),
      message: text(issue?.error_message),
      level: text(issue?.level),
    }))
    .filter((issue) => issue.summary || issue.message);

// What the list row carries: null when the ad has nothing to explain.
export const rejectionSummary = ({ effective_status, review_feedback, issues } = {}) => {
  const reasons = reviewReasons(review_feedback);
  const lines = issueLines(issues);
  if (!reasons.length && !lines.length) return null;
  const first = reasons[0];
  const headline = first ? (first.reason || first.policy_label) : (lines[0].summary || lines[0].message);
  return {
    status: text(effective_status).toUpperCase(),
    headline,
    reasons,
    issues: lines,
  };
};

// Ads Manager opens the ad's edit panel, which carries Meta's own "طلب مراجعة" button; there is
// no Graph endpoint that files an appeal, so the screen links there.
export const adReviewUrl = (adAccountId, adMetaId) => {
  const act = text(adAccountId).replace(/^act_/i, "");
  const id = text(adMetaId);
  if (!act || !id) return "";
  return `https://adsmanager.facebook.com/adsmanager/manage/ads/edit?act=${encodeURIComponent(act)}&selected_ad_ids=${encodeURIComponent(id)}`;
};
