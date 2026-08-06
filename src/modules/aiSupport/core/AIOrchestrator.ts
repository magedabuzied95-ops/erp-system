import { AIContext } from "./AIContext";
import type { AICache, AIAnalysis, AIInput } from "./types";
import type { EngineRegistry } from "./EngineRegistry";
import { Pipeline } from "./Pipeline";

export const ENGINE_VERSION = "1.0.0";

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
};

const cacheKey = (input: AIInput) => [
  input.conversation.id,
  input.conversation.lastMessageTimestamp || input.conversation.messages.at(-1)?.created_at || "",
  input.customer.updatedAt || "",
  input.orders.map((order) => JSON.stringify([order.id, order.status, order.created_at, order.total, order.amount, order.total_amount, order.items])).join("|"),
].map(String).join(":");

export class AIOrchestrator {
  readonly #registry: EngineRegistry;
  readonly #cache?: AICache;

  constructor(registry: EngineRegistry, cache?: AICache) {
    this.#registry = registry;
    this.#cache = cache;
  }

  async analyze(input: AIInput): Promise<AIAnalysis> {
    const key = cacheKey(input);
    let cached: AIAnalysis | undefined;
    try { cached = await this.#cache?.get(key); } catch { cached = undefined; }
    if (cached) return cached;
    const started = performance.now();
    const pipeline = await new Pipeline(this.#registry).execute(new AIContext(input));
    const crm = pipeline.context.results.crm || null;
    const conversation = pipeline.context.results.conversation || null;
    const decision = pipeline.context.results.decision || null;
    const confidences = [conversation?.confidence, decision?.confidence].filter((value): value is number => Number.isFinite(value));
    const confidence = confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : 0;
    const analysis = deepFreeze({ crm, conversation, decision, executionTime: performance.now() - started, version: ENGINE_VERSION, confidence, engineVersions: this.#registry.versions(), processingSteps: pipeline.steps, errors: pipeline.errors }) as AIAnalysis;
    try { await this.#cache?.set(key, analysis); } catch { /* Cache failure must not fail analysis. */ }
    return analysis;
  }
}
