import type { AIPlugin, PluginExecutionResult, PluginProvider, PluginTelemetry } from "./Plugin";
import { PluginContext } from "./PluginContext";
import type { PluginRegistry } from "./PluginRegistry";

export interface PluginLoadResult { context: PluginContext; telemetry: readonly PluginTelemetry[]; }

const versionParts = (version: string) => version.split("-")[0].split(".").map(Number);
const satisfies = (actual: string, required?: string): boolean => {
  if (!required || required === "*") return true;
  const [major, minor, patch] = versionParts(actual), expected = versionParts(required.replace(/^[~^]/, ""));
  if (required.startsWith("^")) return major === expected[0] && (minor > expected[1] || minor === expected[1] && patch >= expected[2]);
  if (required.startsWith("~")) return major === expected[0] && minor === expected[1] && patch >= expected[2];
  return major === expected[0] && minor === expected[1] && patch === expected[2];
};

export class PluginLoader {
  readonly #registry: PluginRegistry;

  constructor(registry: PluginRegistry) { this.#registry = registry; }

  async autoLoad(provider: PluginProvider): Promise<void> {
    const plugins = await provider();
    for (const plugin of plugins) await this.#registry.register(plugin);
    this.resolveLevels(this.#registry.list().filter((plugin) => plugin.enabled));
  }

  async execute(initial: PluginContext): Promise<PluginLoadResult> {
    let context = initial;
    const telemetry: PluginTelemetry[] = [];
    const levels = this.resolveLevels(this.#registry.list().filter((plugin) => plugin.enabled));
    for (const level of levels) {
      const sequential = level.filter((plugin) => plugin.executionMode !== "Parallel");
      const parallel = level.filter((plugin) => plugin.executionMode === "Parallel");
      for (const plugin of sequential) {
        const result = await this.executePlugin(plugin, context);
        telemetry.push(result.telemetry);
        if (result.patch) context = context.withPatch(result.patch);
      }
      if (parallel.length) {
        const results = await Promise.all(parallel.map((plugin) => this.executePlugin(plugin, context)));
        const patch = Object.assign({}, ...results.map((result) => result.patch || {}));
        results.forEach((result) => telemetry.push(result.telemetry));
        context = context.withPatch(patch);
      }
    }
    return { context, telemetry: Object.freeze(telemetry) };
  }

  private resolveLevels(plugins: readonly AIPlugin[]): AIPlugin[][] {
    const available = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    plugins.forEach((plugin) => plugin.dependencies.forEach((dependency) => {
      const target = available.get(dependency.id) || this.#registry.get(dependency.id);
      if (!target && !dependency.optional) throw new Error(`Plugin ${plugin.id} requires missing dependency ${dependency.id}.`);
      if (target && !satisfies(target.version, dependency.version)) throw new Error(`Plugin ${plugin.id} requires ${dependency.id}@${dependency.version}, received ${target.version}.`);
    }));
    const levels: AIPlugin[][] = [], resolved = new Set<string>(), remaining = new Map(available);
    while (remaining.size) {
      const ready = [...remaining.values()].filter((plugin) => plugin.dependencies.filter((item) => !item.optional).every((item) => resolved.has(item.id) || !remaining.has(item.id)));
      if (!ready.length) throw new Error(`Circular plugin dependency detected: ${[...remaining.keys()].join(" -> ")}.`);
      levels.push(ready);
      ready.forEach((plugin) => { resolved.add(plugin.id); remaining.delete(plugin.id); });
    }
    return levels;
  }

  private async executePlugin(plugin: AIPlugin, context: PluginContext): Promise<{ patch?: Readonly<Record<string, unknown>>; telemetry: PluginTelemetry }> {
    const started = performance.now();
    const baseKey = `${plugin.id}:${plugin.version}:${context.input.conversation.id}:${context.input.conversation.lastMessageTimestamp || context.input.conversation.messages.at(-1)?.created_at || ""}:${context.input.customer.updatedAt || ""}`;
    try {
      if (plugin.executionMode === "Conditional" && plugin.shouldExecute && !await plugin.shouldExecute(context)) return { telemetry: { pluginId: plugin.id, version: plugin.version, executionTime: performance.now() - started, cacheHit: false, status: "skipped" } };
      const cached = await context.cache?.get(baseKey) as PluginExecutionResult | undefined;
      if (cached) return { patch: cached.patch, telemetry: { pluginId: plugin.id, version: plugin.version, executionTime: performance.now() - started, cacheHit: true, status: "completed" } };
      await plugin.onExecute?.(context);
      const result = await plugin.execute(context);
      await plugin.onSuccess?.(result, context);
      await context.cache?.set(result.cacheKey || baseKey, result);
      await context.publish("plugin:success", { id: plugin.id, version: plugin.version });
      return { patch: result.patch, telemetry: { pluginId: plugin.id, version: plugin.version, executionTime: performance.now() - started, cacheHit: false, status: "completed" } };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await plugin.onError?.({ pluginId: plugin.id, error, context });
      await context.publish("plugin:error", { id: plugin.id, version: plugin.version, message: error.message });
      return { telemetry: { pluginId: plugin.id, version: plugin.version, executionTime: performance.now() - started, cacheHit: false, status: "failed", error: error.message } };
    }
  }
}

