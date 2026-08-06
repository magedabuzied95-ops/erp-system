import { FeedbackStore, type FeedbackDetails } from "./FeedbackStore";
import { RecommendationHistory } from "./RecommendationHistory";
import { RecommendationTracker, type TrackRecommendationInput } from "./RecommendationTracker";
import { calculateQualityReport, calculateRecommendationAnalytics } from "./LearningMetrics";
import type { FeedbackEventType, LearningInsight, LearningReport, QualityReport, RecommendationAnalytics, RecommendationIdentity, RecommendationRecord, TrainingExample } from "./LearningTypes";

export class LearningEngine {
  readonly history: RecommendationHistory;
  readonly tracker: RecommendationTracker;
  readonly #feedback: FeedbackStore;

  constructor(history = new RecommendationHistory()) {
    this.history = history;
    this.#feedback = new FeedbackStore(history);
    this.tracker = new RecommendationTracker(history, this.#feedback);
  }

  track(input: TrackRecommendationInput): RecommendationRecord { return this.tracker.track(input); }
  feedback(identity: RecommendationIdentity, eventType: FeedbackEventType, details?: FeedbackDetails) { return this.#feedback.record(identity, eventType, details); }
  analytics(): RecommendationAnalytics { return calculateRecommendationAnalytics(this.tracker.states(), this.history); }
  quality(): QualityReport { return calculateQualityReport(this.tracker.states()); }

  report(): LearningReport {
    const analytics = this.analytics(), quality = this.quality();
    const insights: LearningInsight[] = analytics.byType.filter((item) => item.total > 0).flatMap((item) => {
      const results: LearningInsight[] = [];
      if (item.accepted) results.push({ statement: `${item.type} recommendations are accepted ${Math.round(item.accepted / item.total * 100)}% of the time.`, evidenceCount: item.total, confidence: Math.min(100, 50 + item.total * 2) });
      if (item.rejected) results.push({ statement: `${item.type} recommendations are rejected ${Math.round(item.rejected / item.total * 100)}% of the time.`, evidenceCount: item.total, confidence: Math.min(100, 50 + item.total * 2) });
      return results;
    });
    return Object.freeze({ generatedAt: new Date().toISOString(), analytics, quality, insights: Object.freeze(insights) });
  }

  trainingExamples(): readonly TrainingExample[] {
    const quality = new Map(this.quality().recommendations.map((item) => [item.recommendationId, item]));
    return Object.freeze(this.history.recommendations().map((recommendation) => Object.freeze({ input: Object.freeze({ conversationId: recommendation.conversationId, customerId: recommendation.customerId, metadata: recommendation.metadata }), recommendation, feedback: this.history.eventsFor(recommendation.recommendationId), outcome: quality.get(recommendation.recommendationId)! })));
  }
}

export type { LearningReport, QualityReport, RecommendationAnalytics } from "./LearningTypes";

