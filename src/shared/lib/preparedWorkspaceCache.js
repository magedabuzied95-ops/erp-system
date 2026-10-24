// RAM only, partitioned by authenticated user/tenant/permissions/branch.
export function createPreparedWorkspaceCache({ scope, now = Date.now, ttlMs = 30000 }) {
  let currentScope = '';
  const entries = new Map();
  const clear = () => {
    for (const entry of entries.values()) entry.controller?.abort();
    entries.clear();
    currentScope = '';
  };
  const scoped = () => {
    const next = scope();
    if (next !== currentScope) { clear(); currentScope = next; }
    return next;
  };
  const fresh = (entry) => entry && now() - entry.at < ttlMs;
  const start = (key, loader, consumed) => {
    const identity = scoped();
    if (!identity) return Promise.resolve(null);
    const entry = { at: now(), consumed, controller: new AbortController() };
    entries.set(key, entry);
    entry.pending = Promise.resolve().then(() => loader(entry.controller.signal)).then((data) => {
      if (scope() !== identity || entry.controller.signal.aborted) throw new Error('Workspace scope changed');
      entry.data = data;
      entry.at = now();
      entry.pending = null;
      return data;
    }).catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    return entry.pending;
  };
  return {
    clear,
    peek(key) { if (!scoped()) return null; const e = entries.get(key); return fresh(e) ? e.data ?? null : null; },
    prepare(key, loader) {
      if (!scoped()) return Promise.resolve(null);
      const e = entries.get(key);
      if (e?.pending) return e.pending;
      return fresh(e) ? Promise.resolve(e.data) : start(key, loader, false);
    },
    read(key, loader, { force = false } = {}) {
      if (!scoped()) return loader();
      const e = entries.get(key);
      if (!force && e?.pending) { e.consumed = true; return e.pending; }
      if (!force && fresh(e) && !e.consumed) { e.consumed = true; return Promise.resolve(e.data); }
      return start(key, loader, true);
    },
  };
}
