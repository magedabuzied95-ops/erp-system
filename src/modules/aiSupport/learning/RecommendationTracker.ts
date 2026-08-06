import type { FeedbackDetails } from "./FeedbackStore";
import type { FeedbackStore } from "./FeedbackStore";
import type { RecommendationHistory } from "./RecommendationHistory";
import type { RecommendationIdentity, RecommendationRecord, RecommendationState, RecommendationType } from "./LearningTypes";

export interface TrackRecommendationInput { recommendationId: string; recommendationType: RecommendationType; userId: string; conversationId: string; customerId: string; source: string; confidence: number; createdAt?: string; userRole?: string; team?: string; metadata?: Readonly<Record<string, unknown>>; }

export class RecommendationTracker {
  constructor(private readonly history: RecommendationHistory, private readonly feedback: FeedbackStore) {}

  track(input: TrackRecommendationInput): RecommendationRecord {
    const record: RecommendationRecord = Object.freeze({ ...input, createdAt: input.createdAt || new Date().toISOString(), metadata: Object.freeze({ ...(input.metadata || {}) }) });
    this.history.appendRecommendation(record);
    return record;
  }

  accept(identity: RecommendationIdentity, details?: FeedbackDetails) { return this.feedback.record(identity, "Accepted", details); }
  reject(identity: RecommendationIdentity, details?: FeedbackDetails) { return this.feedback.record(identity, "Rejected", details); }
  ignore(identity: RecommendationIdentity, details?: FeedbackDetails) { return this.feedback.record(identity, "Ignored", details); }
  execute(identity: RecommendationIdentity, details?: FeedbackDetails) { return this.feedback.record(identity, "Executed", details); }
  override(identity: RecommendationIdentity, details: FeedbackDetails) { return this.feedback.record(identity, "Manual Override", details); }
  executionResult(identity: RecommendationIdentity, details: FeedbackDetails) { return this.feedback.record(identity, "Execution Result", details); }

  states(): readonly RecommendationState[] {
    return Object.freeze(this.history.recommendations().map((record) => {
      const events = this.history.eventsFor(record.recommendationId);
      const latest = <T>(selector: (event: typeof events[number]) => T | undefined) => [...events].reverse().map(selector).find((value) => value !== undefined) ?? null;
      return Object.freeze({ ...record, accepted: events.some((event) => event.eventType === "Accepted"), rejected: events.some((event) => event.eventType === "Rejected"), ignored: events.some((event) => event.eventType === "Ignored"), executed: events.some((event) => event.eventType === "Executed"), manuallyOverridden: events.some((event) => event.eventType === "Manual Override"), executionTime: latest((event) => event.executionTime), userResponseTime: latest((event) => event.userResponseTime), successful: latest((event) => event.successful) });
    }));
  }
}

