import type { FeedbackEvent, FeedbackEventType, RecommendationIdentity } from "./LearningTypes";
import type { RecommendationHistory } from "./RecommendationHistory";

export interface FeedbackDetails { executionTime?: number; userResponseTime?: number; successful?: boolean; overrideValue?: unknown; result?: Readonly<Record<string, unknown>>; occurredAt?: string; }

export class FeedbackStore {
  constructor(private readonly history: RecommendationHistory) {}

  record(identity: RecommendationIdentity, eventType: FeedbackEventType, details: FeedbackDetails = {}): FeedbackEvent {
    const event: FeedbackEvent = Object.freeze({
      ...identity,
      eventId: `${identity.recommendationId}:${eventType}:${crypto.randomUUID()}`,
      eventType,
      occurredAt: details.occurredAt || new Date().toISOString(),
      executionTime: details.executionTime,
      userResponseTime: details.userResponseTime,
      successful: details.successful,
      overrideValue: details.overrideValue,
      result: details.result,
    });
    this.history.appendEvent(event);
    return event;
  }
}

