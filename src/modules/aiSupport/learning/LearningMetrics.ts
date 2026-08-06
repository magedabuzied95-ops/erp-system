import type { RecommendationHistory } from "./RecommendationHistory";
import type { CopilotFeedbackMetrics, LearningMetrics, QualityReport, RecommendationAnalytics, RecommendationQuality, RecommendationState, TypeAnalytics, TypeMetric } from "./LearningTypes";

const rate = (value: number, total: number) => total ? Math.round(value / total * 10000) / 100 : 0;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function topTypes(states: readonly RecommendationState[], key: "accepted" | "rejected"): TypeMetric[] {
  const groups = new Map<string, { count: number; total: number }>();
  states.forEach((state) => {
    const group = groups.get(state.recommendationType) || { count: 0, total: 0 };
    group.total += 1;
    if (state[key]) group.count += 1;
    groups.set(state.recommendationType, group);
  });
  return [...groups].map(([type, values]) => ({ type, count: values.count, rate: rate(values.count, values.total) })).filter((item) => item.count).sort((a, b) => b.rate - a.rate || b.count - a.count).slice(0, 5);
}

export function calculateLearningMetrics(states: readonly RecommendationState[], history: RecommendationHistory): LearningMetrics {
  const total = states.length;
  const decisionTimes = states.map((state) => {
    const first = history.eventsFor(state.recommendationId).find((event) => ["Accepted", "Rejected", "Ignored", "Manual Override"].includes(event.eventType));
    return first ? new Date(first.occurredAt).getTime() - new Date(state.createdAt).getTime() : null;
  }).filter((value): value is number => value !== null && value >= 0);
  return Object.freeze({ totalRecommendations: total, acceptanceRate: rate(states.filter((state) => state.accepted).length, total), rejectionRate: rate(states.filter((state) => state.rejected).length, total), ignoreRate: rate(states.filter((state) => state.ignored).length, total), executionRate: rate(states.filter((state) => state.executed).length, total), averageDecisionTime: average(decisionTimes), averageUserResponseTime: average(states.map((state) => state.userResponseTime).filter((value): value is number => value !== null)), topAcceptedRecommendationTypes: Object.freeze(topTypes(states, "accepted")), topRejectedRecommendationTypes: Object.freeze(topTypes(states, "rejected")) });
}

export function calculateQualityReport(states: readonly RecommendationState[]): QualityReport {
  const recommendations: RecommendationQuality[] = states.map((state) => {
    const successScore = Math.min(100, (state.accepted ? 40 : 0) + (state.executed ? 25 : 0) + (state.successful === true ? 35 : 0));
    const failureScore = Math.min(100, (state.rejected ? 45 : 0) + (state.ignored ? 15 : 0) + (state.manuallyOverridden ? 20 : 0) + (state.successful === false ? 35 : 0));
    return Object.freeze({ recommendationId: state.recommendationId, successScore, failureScore, confidenceDelta: Math.round((successScore - state.confidence) * 100) / 100 });
  });
  return Object.freeze({ generatedAt: new Date().toISOString(), recommendations: Object.freeze(recommendations), averageSuccessScore: average(recommendations.map((item) => item.successScore)), averageFailureScore: average(recommendations.map((item) => item.failureScore)), averageConfidenceDelta: average(recommendations.map((item) => item.confidenceDelta)) });
}

export function calculateRecommendationAnalytics(states: readonly RecommendationState[], history: RecommendationHistory): RecommendationAnalytics {
  const types = [...new Set(states.map((state) => state.recommendationType))];
  const byType: TypeAnalytics[] = types.map((type) => {
    const group = states.filter((state) => state.recommendationType === type), successful = group.filter((state) => state.successful === true || state.accepted && state.executed).length;
    return { type, total: group.length, accepted: group.filter((state) => state.accepted).length, rejected: group.filter((state) => state.rejected).length, ignored: group.filter((state) => state.ignored).length, executed: group.filter((state) => state.executed).length, successRate: rate(successful, group.length) };
  });
  const usage = (type: string) => rate(states.filter((state) => state.recommendationType === type && state.executed).length, states.filter((state) => state.recommendationType === type).length);
  const acceptance = (type: string) => rate(states.filter((state) => state.recommendationType === type && state.accepted).length, states.filter((state) => state.recommendationType === type).length);
  const copilot: CopilotFeedbackMetrics = { quickReplyUsage: usage("Quick Reply"), suggestedActionUsage: usage("Suggested Action"), suggestionAcceptance: acceptance("Suggestion"), warningUsefulness: acceptance("Warning") };
  return Object.freeze({ metrics: calculateLearningMetrics(states, history), copilot: Object.freeze(copilot), byType: Object.freeze(byType) });
}
