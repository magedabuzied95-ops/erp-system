import type { AIEngine } from "./AIEngine";

export class EngineRegistry {
  readonly #engines: ReadonlyMap<string, AIEngine>;

  constructor(engines: readonly AIEngine[]) {
    const entries = engines.map((engine) => [engine.name, engine] as const);
    if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new Error("AI engine names must be unique.");
    this.#engines = new Map(entries);
    this.validateDependencies();
  }

  get(name: string): AIEngine | undefined { return this.#engines.get(name); }
  all(): readonly AIEngine[] { return [...this.#engines.values()]; }
  versions(): Readonly<Record<string, string>> { return Object.freeze(Object.fromEntries(this.all().map((engine) => [engine.name, engine.version]))); }

  private validateDependencies(): void {
    this.all().forEach((engine) => engine.dependencies?.forEach((dependency) => {
      if (!this.#engines.has(dependency)) throw new Error(`Engine ${engine.name} requires missing dependency ${dependency}.`);
    }));
  }
}

