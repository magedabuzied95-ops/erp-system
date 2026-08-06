import type { FeedbackEvent, RecommendationRecord } from "./LearningTypes";

const immutable = <T>(value: T): Readonly<T> => Object.freeze(structuredClone(value));

export class RecommendationHistory {
  readonly #recommendations: RecommendationRecord[] = [];
  readonly #events: FeedbackEvent[] = [];

  appendRecommendation(record: RecommendationRecord): void {
    if (this.#recommendations.some((item) => item.recommendationId === record.recommendationId)) throw new Error(`Recommendation ${record.recommendationId} already exists.`);
    this.#recommendations.push(immutable(record) as RecommendationRecord);
  }

  appendEvent(event: FeedbackEvent): void {
    if (!this.#recommendations.some((item) => item.recommendationId === event.recommendationId)) throw new Error(`Recommendation ${event.recommendationId} is not tracked.`);
    if (this.#events.some((item) => item.eventId === event.eventId)) throw new Error(`Feedback event ${event.eventId} already exists.`);
    this.#events.push(immutable(event) as FeedbackEvent);
  }

  recommendations(): readonly RecommendationRecord[] { return Object.freeze([...this.#recommendations]); }
  events(): readonly FeedbackEvent[] { return Object.freeze([...this.#events]); }
  eventsFor(recommendationId: string): readonly FeedbackEvent[] { return Object.freeze(this.#events.filter((event) => event.recommendationId === recommendationId)); }
}

