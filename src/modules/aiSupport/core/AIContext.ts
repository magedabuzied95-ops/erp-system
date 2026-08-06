import type { AIEngineResults, AIInput } from "./types";

export class AIContext {
  readonly input: Readonly<AIInput>;
  readonly results: Readonly<AIEngineResults>;

  constructor(input: AIInput, results: AIEngineResults = {}) {
    this.input = input;
    this.results = results;
  }

  withResults(results: AIEngineResults): AIContext {
    return new AIContext(this.input as AIInput, { ...this.results, ...results });
  }
}

