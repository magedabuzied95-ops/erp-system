import type { AIInput } from "../types";
import type { PluginPatch } from "./Plugin";

export type PluginEventHandler<T = unknown> = (payload: Readonly<T>) => void | Promise<void>;
export interface PluginCache { get(key: string): unknown | Promise<unknown>; set(key: string, value: unknown): void | Promise<void>; }

const freeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

export class PluginEventBus {
  readonly #listeners = new Map<string, Set<PluginEventHandler>>();

  subscribe<T>(event: string, handler: PluginEventHandler<T>): () => void {
    const listeners = this.#listeners.get(event) || new Set<PluginEventHandler>();
    listeners.add(handler as PluginEventHandler);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(handler as PluginEventHandler);
  }

  async publish<T>(event: string, payload: T): Promise<void> {
    const immutablePayload = freeze(structuredClone(payload));
    await Promise.all([...(this.#listeners.get(event) || [])].map((handler) => handler(immutablePayload)));
  }
}

export class PluginContext {
  readonly input: Readonly<AIInput>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly cache?: PluginCache;
  readonly #events: PluginEventBus;

  constructor(input: AIInput, state: Record<string, unknown> = {}, events = new PluginEventBus(), cache?: PluginCache) {
    this.input = freeze(structuredClone(input));
    this.state = freeze(structuredClone(state));
    this.#events = events;
    this.cache = cache;
  }

  withPatch(patch: PluginPatch): PluginContext {
    return new PluginContext(this.input as AIInput, { ...this.state, ...patch }, this.#events, this.cache);
  }

  publish<T>(event: string, payload: T): Promise<void> { return this.#events.publish(event, payload); }
  subscribe<T>(event: string, handler: PluginEventHandler<T>): () => void { return this.#events.subscribe(event, handler); }
}

