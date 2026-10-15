// Runs an Express handler in-process (same user, same tenant) and returns what it answered,
// so a wholesale flow can reuse a battle-tested endpoint instead of copying its logic.
export const runHandler = (handler, req, { body, params } = {}) =>
  new Promise((resolve, reject) => {
    const innerReq = Object.create(req);
    if (body !== undefined) innerReq.body = body;
    if (params !== undefined) innerReq.params = { ...(req.params || {}), ...params };
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) { this.statusCode = code; return this; },
      set() { return this; },
      setHeader() { return this; },
      json(payload) { this.headersSent = true; resolve({ status: this.statusCode, body: payload }); return this; },
      send(payload) { this.headersSent = true; resolve({ status: this.statusCode, body: payload }); return this; },
      end() { this.headersSent = true; resolve({ status: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(handler(innerReq, res)).catch(reject);
  });
