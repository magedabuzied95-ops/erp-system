import { AIContext } from "./AIContext";
import type { AIEngine } from "./AIEngine";
import type { AIEngineError, AIEngineResults, AIProcessingStep } from "./types";
import type { EngineRegistry } from "./EngineRegistry";

export interface PipelineResult { context: AIContext; steps: AIProcessingStep[]; errors: AIEngineError[]; }
interface EngineExecution { engine: AIEngine; value?: unknown; step: AIProcessingStep; error?: AIEngineError; }

export class Pipeline {
  constructor(private readonly registry: EngineRegistry) {}

  async execute(initial: AIContext): Promise<PipelineResult> {
    let context = initial;
    const pending = new Map(this.registry.all().map((engine) => [engine.name, engine]));
    const completed = new Set<string>(), failed = new Set<string>();
    const steps: AIProcessingStep[] = [], errors: AIEngineError[] = [];
    while (pending.size) {
      const ready = [...pending.values()].filter((engine) => (engine.dependencies || []).every((name) => completed.has(name) || failed.has(name)));
      if (!ready.length) throw new Error("AI engine dependency cycle detected.");
      const batch = await Promise.all(ready.map((engine) => this.executeEngine(engine, context)));
      const additions: AIEngineResults = {};
      batch.forEach(({ engine, value, step, error }) => {
        pending.delete(engine.name); steps.push(step);
        if (error) { failed.add(engine.name); errors.push(error); } else { completed.add(engine.name); additions[engine.name] = value; }
      });
      context = context.withResults(additions);
    }
    return { context, steps, errors };
  }

  private async executeEngine(engine: AIEngine, context: AIContext): Promise<EngineExecution> {
    const started = performance.now();
    try {
      const value = await engine.execute(context);
      return { engine, value, step: { engine: engine.name, version: engine.version, status: "completed" as const, executionTime: performance.now() - started } };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { engine, value: undefined, error: { engine: engine.name, message }, step: { engine: engine.name, version: engine.version, status: "failed" as const, executionTime: performance.now() - started } };
    }
  }
}
