// One bounded batch per identity, with a one-use handoff to the inbox.
export const createInboxPrefetch = ({ channels, fetchPage, savePage, isCurrent, now = Date.now, ttlMs = 60000 }) => {
  let active = '';
  let startedAt = -Infinity;
  let controller = null;
  const pages = new Map();
  const clear = () => {
    controller?.abort();
    controller = null;
    active = '';
    startedAt = -Infinity;
    pages.clear();
  };
  const start = (identity) => {
    if (!identity || !isCurrent(identity)) return Promise.resolve();
    if (active === identity && now() - startedAt < ttlMs) return Promise.resolve();
    clear();
    active = identity;
    startedAt = now();
    const batchController = new AbortController();
    controller = batchController;
    const queue = [...channels];
    const valid = () => !batchController.signal.aborted && active === identity && isCurrent(identity);
    const worker = async () => {
      while (queue.length && valid()) {
        const channel = queue.shift();
        const entry = { at: now(), promise: null };
        entry.promise = Promise.resolve().then(() => fetchPage(channel, batchController.signal)).then((payload) => {
          if (!valid()) throw new Error('Inbox identity changed');
          entry.at = now();
          entry.payload = payload;
          savePage(channel, payload);
          return payload;
        }).catch((error) => {
          if (pages.get(channel) === entry) pages.delete(channel);
          throw error;
        });
        pages.set(channel, entry);
        // Failures in optional preloading never surface as page errors.
        await entry.promise.catch(() => {});
      }
    };
    return Promise.all([worker(), worker()]).then(() => {});
  };
  const take = (identity, channel) => {
    if (identity !== active || !isCurrent(identity)) return null;
    const entry = pages.get(channel);
    if (!entry || now() - entry.at >= ttlMs) return null;
    pages.delete(channel);
    return entry.promise;
  };
  const peek = (identity, channel) => {
    if (identity !== active || !isCurrent(identity)) return null;
    const entry = pages.get(channel);
    return entry && now() - entry.at < ttlMs ? entry.payload || null : null;
  };
  return { start, take, peek, clear };
};
