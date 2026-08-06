import type { AIPlugin } from "./Plugin";
import type { PluginContext } from "./PluginContext";

export class PluginRegistry {
  readonly #plugins = new Map<string, AIPlugin>();
  readonly #context: PluginContext;

  constructor(context: PluginContext) { this.#context = context; }

  async register(plugin: AIPlugin): Promise<void> {
    if (this.#plugins.has(plugin.id)) throw new Error(`Plugin ${plugin.id} is already registered.`);
    this.validateIdentity(plugin);
    this.#plugins.set(plugin.id, plugin);
    try { await plugin.onRegister?.(this.#context); await this.#context.publish("plugin:registered", { id: plugin.id, version: plugin.version }); }
    catch (error) { this.#plugins.delete(plugin.id); throw error; }
  }

  async unregister(id: string): Promise<boolean> {
    const plugin = this.#plugins.get(id);
    if (!plugin) return false;
    await plugin.onDispose?.(this.#context);
    this.#plugins.delete(id);
    await this.#context.publish("plugin:unregistered", { id });
    return true;
  }

  async enable(id: string): Promise<void> { const plugin = this.require(id); plugin.enabled = true; await this.#context.publish("plugin:enabled", { id }); }
  async disable(id: string): Promise<void> { const plugin = this.require(id); plugin.enabled = false; await this.#context.publish("plugin:disabled", { id }); }

  async replace(id: string, replacement: AIPlugin): Promise<void> {
    const previous = this.require(id);
    if (replacement.id !== id) throw new Error("Replacement plugin must preserve the plugin id.");
    await previous.onDispose?.(this.#context);
    this.validateIdentity(replacement);
    this.#plugins.set(id, replacement);
    try { await replacement.onRegister?.(this.#context); await this.#context.publish("plugin:replaced", { id, version: replacement.version }); }
    catch (error) { this.#plugins.set(id, previous); await previous.onRegister?.(this.#context); throw error; }
  }

  list(): readonly AIPlugin[] { return Object.freeze([...this.#plugins.values()]); }
  get(id: string): AIPlugin | undefined { return this.#plugins.get(id); }

  private require(id: string): AIPlugin { const plugin = this.#plugins.get(id); if (!plugin) throw new Error(`Plugin ${id} is not registered.`); return plugin; }
  private validateIdentity(plugin: AIPlugin): void {
    if (!plugin.id.trim() || !plugin.name.trim()) throw new Error("Plugin id and name are required.");
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plugin.version)) throw new Error(`Plugin ${plugin.id} has invalid semantic version ${plugin.version}.`);
  }
}

