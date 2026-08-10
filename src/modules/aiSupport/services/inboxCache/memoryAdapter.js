// In-memory storage adapter — used by tests and as a safe fallback if IndexedDB
// is unavailable at runtime. Mirrors the async idbKeyval adapter surface.
export const createMemoryAdapter = (initial) => {
  const map = new Map(initial instanceof Map ? initial : undefined);
  return {
    get: async (key) => (map.has(key) ? map.get(key) : undefined),
    set: async (key, value) => { map.set(key, value); },
    delete: async (key) => { map.delete(key); },
    keys: async () => [...map.keys()],
    clear: async () => { map.clear(); },
    available: () => true,
    _map: map,
  };
};

export default createMemoryAdapter;
