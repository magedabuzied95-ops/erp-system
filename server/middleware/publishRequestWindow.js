/*
  The global request timeout is 60s (REQUEST_TIMEOUT_MS in server.js). A publish
  legitimately outlives it: Meta fetches every image from our origin before it
  answers, so an album or a multi-slide story spends the whole budget on uploads
  and the app then kills its own request with a 503 while the publish is still
  running — the work completes, the browser is told it failed, and the next click
  publishes a duplicate.

  90s is the widest window that can still deliver a real answer: Cloudflare cuts a
  proxied connection at 100s, and past that the client gets a proxy error page
  instead of our response.

  Passing NO callback is deliberate — the global timeout handler stays registered
  and now fires at this longer deadline instead of at 60s.
*/
export const PUBLISH_REQUEST_TIMEOUT_MS = 90_000;

export const publishRequestWindow = (req, res, next) => {
  req.setTimeout(PUBLISH_REQUEST_TIMEOUT_MS);
  res.setTimeout(PUBLISH_REQUEST_TIMEOUT_MS);
  next();
};

export default publishRequestWindow;
