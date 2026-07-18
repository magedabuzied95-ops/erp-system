import { assertChannelAdapter } from "./ChannelAdapter.js";

export class AdapterRegistry {
  constructor() {
    this.adapters = new Map();
  }

  key(connectionId) {
    return String(connectionId || "").trim();
  }

  register(connectionId, adapter) {
    const key = this.key(connectionId);
    if (!key) throw new Error("connectionId is required");
    if (this.adapters.has(key)) throw new Error(`Adapter already registered: ${key}`);
    this.adapters.set(key, assertChannelAdapter(adapter));
    return adapter;
  }

  get(connectionId) {
    return this.adapters.get(this.key(connectionId)) || null;
  }

  unregister(connectionId) {
    return this.adapters.delete(this.key(connectionId));
  }

  entries() {
    return [...this.adapters.entries()];
  }
}

export default AdapterRegistry;
