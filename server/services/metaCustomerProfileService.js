/*
 * Meta customer profile policy: which Graph endpoint answers for which channel, when a
 * stored profile is fresh enough to skip Meta, how a fresh answer merges into what is
 * already stored, and one in-process coordinator so the same customer is never asked
 * for twice at the same time.
 *
 * Everything here is pure (no db, no fetch) so it can be unit-tested; the Graph call
 * and the persistence live in metaIntegrationService.js and take these decisions.
 *
 * Channel rules (Business Asset User Profile Access):
 *   Messenger  — GET graph.facebook.com/{PSID}?fields=first_name,last_name,name,profile_pic
 *                with the PAGE access token of the page the customer wrote to.
 *   Instagram  — GET /{IGSID}?fields=name,username,profile_pic. The host follows the
 *                token: an Instagram-Login token is answered by graph.instagram.com,
 *                a Facebook-Login (page-linked) token by graph.facebook.com. When the
 *                preferred host answers 200 with no usable field, the other official
 *                host is tried once.
 */

const text = (value = "") => String(value ?? "").trim();
const envNumber = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const META_PROFILE_CHANNELS = Object.freeze({
  MESSENGER: "facebook_messenger",
  INSTAGRAM: "instagram",
});

// A complete profile (name + picture) is trusted for a day before Meta is asked again.
export const META_PROFILE_TTL_MS = envNumber("META_PROFILE_TTL_MS", 24 * 60 * 60 * 1000);
// A profile Meta answered but left incomplete (name without a picture, or the other way
// round) is asked about again after this long, not on every message.
export const META_PROFILE_MISSING_RETRY_MS = envNumber("META_PROFILE_MISSING_RETRY_MS", 30 * 60 * 1000);
// After a failed Graph call the customer is left alone for this long.
export const META_PROFILE_FAILURE_BACKOFF_MS = envNumber("META_PROFILE_FAILURE_BACKOFF_MS", 15 * 60 * 1000);
// A permission/"not available" answer is not going to change in a minute.
export const META_PROFILE_UNAVAILABLE_BACKOFF_MS = envNumber("META_PROFILE_UNAVAILABLE_BACKOFF_MS", 6 * 60 * 60 * 1000);
// Hard ceiling on a single Graph profile request.
export const META_PROFILE_FETCH_TIMEOUT_MS = envNumber("META_PROFILE_FETCH_TIMEOUT_MS", 8000);
// The webhook stores the message first, then gives Meta this long to answer so the
// first AI reply can still greet by name. Anything slower finishes in the background.
export const META_PROFILE_WEBHOOK_WAIT_MS = envNumber("META_PROFILE_WEBHOOK_WAIT_MS", 2500);

export const MESSENGER_PROFILE_FIELDS = "first_name,last_name,name,profile_pic";
export const INSTAGRAM_PROFILE_FIELDS = "name,username,profile_pic";

export const normalizeMetaProfileChannel = (channel = "") => {
  const value = text(channel).toLowerCase();
  if (!value) return "";
  if (value === "instagram" || value === "instagram_dm" || value.startsWith("instagram")) return META_PROFILE_CHANNELS.INSTAGRAM;
  if (["facebook_messenger", "facebook", "messenger"].includes(value) || value.includes("messenger")) return META_PROFILE_CHANNELS.MESSENGER;
  return "";
};

export const isMetaScopedUserId = (value = "") => /^\d{5,}$/.test(text(value));

// A name Meta itself returned is authoritative. It only has to look like a name
// structurally (bounded, printable, has a letter, not a bare id). The message-fragment
// heuristics that guard names captured from chat text ("ممكن صور…") must NOT run on
// it: "هايدي", "شيفين", "Mohamed A." and "Ahmed 2020" are real people, and the
// substring/digit/punctuation rules threw their Graph names away.
export const isPlausibleMetaProfileName = (value = "") => {
  const candidate = text(value).replace(/\s+/g, " ");
  if (!candidate || candidate.length > 80) return false;
  if (/\p{Cc}/u.test(candidate)) return false;
  if (isMetaScopedUserId(candidate.replace(/\s+/g, ""))) return false;
  if (!/\p{L}/u.test(candidate)) return false;
  return true;
};

// Which host + fields + token answer for a channel. Instagram is the only channel
// whose host depends on the token type.
export const resolveMetaProfileRequest = ({ channel = "", externalCustomerId = "", instagramBusinessLogin = false } = {}) => {
  const normalizedChannel = normalizeMetaProfileChannel(channel);
  const id = text(externalCustomerId);
  if (!normalizedChannel || !isMetaScopedUserId(id)) return null;
  const path = `/${encodeURIComponent(id)}`;
  if (normalizedChannel === META_PROFILE_CHANNELS.INSTAGRAM) {
    const primary = instagramBusinessLogin ? "graph.instagram.com" : "graph.facebook.com";
    const fallback = instagramBusinessLogin ? "graph.facebook.com" : "graph.instagram.com";
    return {
      channel: normalizedChannel,
      path,
      fields: INSTAGRAM_PROFILE_FIELDS,
      host: primary,
      fallbackHost: fallback,
      token: instagramBusinessLogin ? "instagram_user_token" : "page_access_token",
    };
  }
  return {
    channel: normalizedChannel,
    path,
    fields: MESSENGER_PROFILE_FIELDS,
    host: "graph.facebook.com",
    fallbackHost: "",
    token: "page_access_token",
  };
};

// Turn a Graph answer into the one profile shape the rest of the code stores.
export const normalizeMetaProfilePayload = ({ channel = "", payload = {} } = {}) => {
  const normalizedChannel = normalizeMetaProfileChannel(channel);
  const source = payload && typeof payload === "object" ? payload : {};
  const picture = text(
    typeof source.profile_pic === "string"
      ? source.profile_pic
      : source.profile_pic?.data?.url || source.profile_picture_url || source.picture?.data?.url || ""
  );
  if (normalizedChannel === META_PROFILE_CHANNELS.INSTAGRAM) {
    const username = text(source.username).replace(/^@/, "");
    const name = text(source.name);
    return {
      first_name: name,
      last_name: "",
      name,
      username,
      profile_pic: picture,
    };
  }
  const firstName = text(source.first_name);
  const lastName = text(source.last_name);
  const name = text(source.name) || [firstName, lastName].filter(Boolean).join(" ");
  return {
    first_name: firstName,
    last_name: lastName,
    name,
    username: "",
    profile_pic: picture,
  };
};

export const hasUsableMetaProfile = (profile = {}) =>
  Boolean(profile && (text(profile.name) || text(profile.username) || text(profile.profile_pic) || text(profile.first_name)));

// A fresh answer never blanks a value that is already stored. Meta withholding the
// picture today does not make yesterday's picture wrong.
export const mergeMetaProfile = (existing = {}, incoming = {}) => {
  const base = existing && typeof existing === "object" ? existing : {};
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const pick = (key) => text(next[key]) || text(base[key]);
  return {
    first_name: pick("first_name"),
    last_name: pick("last_name"),
    name: pick("name"),
    username: pick("username"),
    profile_pic: pick("profile_pic"),
  };
};

const parseTimestamp = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

// Decide whether Meta should be asked for this customer now.
//   cached: { name, profile_pic, profile_fetched_at } — what the database already holds
//   failure: { at, kind } — the coordinator's memory of the last failed attempt
export const resolveMetaProfileRefreshDecision = ({
  cached = null,
  failure = null,
  now = Date.now(),
  forceRefresh = false,
  ttlMs = META_PROFILE_TTL_MS,
  missingRetryMs = META_PROFILE_MISSING_RETRY_MS,
  failureBackoffMs = META_PROFILE_FAILURE_BACKOFF_MS,
  unavailableBackoffMs = META_PROFILE_UNAVAILABLE_BACKOFF_MS,
} = {}) => {
  if (forceRefresh) return { refresh: true, reason: "forced" };
  const hasName = Boolean(text(cached?.name));
  const hasPicture = Boolean(text(cached?.profile_pic));
  const fetchedAt = parseTimestamp(cached?.profile_fetched_at);
  const ageMs = fetchedAt ? now - fetchedAt.getTime() : Number.POSITIVE_INFINITY;

  if (failure?.at) {
    const backoff = failure.kind === "unavailable" || failure.kind === "permission" ? unavailableBackoffMs : failureBackoffMs;
    if (now - Number(failure.at) < backoff) {
      return { refresh: false, reason: `failure_backoff:${failure.kind || "error"}` };
    }
  }
  if (hasName && hasPicture) {
    if (ageMs < ttlMs) return { refresh: false, reason: "fresh" };
    return { refresh: true, reason: "stale" };
  }
  if (!fetchedAt) return { refresh: true, reason: hasName || hasPicture ? "incomplete_never_fetched" : "missing" };
  if (ageMs < missingRetryMs) return { refresh: false, reason: "incomplete_recently_fetched" };
  return { refresh: true, reason: "incomplete" };
};

// Sort a Graph failure into something the backoff and the operator can act on.
// Never includes the token or the raw payload.
export const classifyMetaProfileError = (error = {}) => {
  const meta = error?.meta && typeof error.meta === "object" ? error.meta : {};
  const code = Number(meta.code ?? error?.code ?? 0) || 0;
  const subcode = Number(meta.error_subcode ?? error?.subcode ?? 0) || 0;
  const status = Number(error?.status || 0) || 0;
  const message = text(meta.message || error?.message || "");
  const lowered = message.toLowerCase();
  let kind = "unknown";
  if (error?.name === "AbortError" || /timed? ?out/i.test(lowered)) kind = "timeout";
  else if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) kind = "rate_limit";
  else if (code === 190 || subcode === 463 || subcode === 467 || /access token/i.test(lowered)) kind = "token";
  else if (code === 100 && subcode === 33) kind = "unavailable";
  else if (code === 100 && /nonexisting field|does not exist|cannot be loaded/i.test(lowered)) kind = "unavailable";
  else if (code === 10 || code === 200 || code === 230 || code === 3 || /permission|not authorized/i.test(lowered)) kind = "permission";
  else if (code === 2018001 || code === 2018218 || /no matching user|user not found|no profile available/i.test(lowered)) kind = "unavailable";
  else if (status >= 500 || code === 1 || code === 2) kind = "transient";
  else if (status >= 400) kind = "rejected";
  const retryable = ["timeout", "rate_limit", "transient", "unknown"].includes(kind);
  return { kind, code, subcode, status, retryable, message: message.slice(0, 200) };
};

// One coordinator per process: an in-flight fetch for a customer is shared by every
// caller that asks while it runs, and a failure is remembered so the next message
// does not immediately ask again.
export const createMetaProfileCoordinator = ({ now = () => Date.now(), maxEntries = 5000 } = {}) => {
  const inFlight = new Map();
  const failures = new Map();

  const trim = () => {
    if (failures.size <= maxEntries) return;
    const cutoff = now() - Math.max(META_PROFILE_FAILURE_BACKOFF_MS, META_PROFILE_UNAVAILABLE_BACKOFF_MS);
    for (const [key, entry] of failures) {
      if (Number(entry?.at || 0) < cutoff) failures.delete(key);
    }
    while (failures.size > maxEntries) {
      const oldest = failures.keys().next().value;
      failures.delete(oldest);
    }
  };

  return {
    key: ({ tenantId, channel, externalCustomerId }) =>
      `${Number(tenantId) || 0}|${normalizeMetaProfileChannel(channel)}|${text(externalCustomerId)}`,
    isInFlight: (key) => inFlight.has(key),
    inFlightCount: () => inFlight.size,
    getFailure: (key) => failures.get(key) || null,
    noteFailure: (key, error) => {
      const classified = classifyMetaProfileError(error);
      failures.set(key, { at: now(), kind: classified.kind, code: classified.code, subcode: classified.subcode });
      trim();
      return classified;
    },
    clearFailure: (key) => failures.delete(key),
    // Runs `task` once for `key`; concurrent callers get the same promise.
    run: (key, task) => {
      const existing = inFlight.get(key);
      if (existing) return { promise: existing, shared: true };
      const promise = Promise.resolve()
        .then(task)
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        });
      inFlight.set(key, promise);
      return { promise, shared: false };
    },
    reset: () => {
      inFlight.clear();
      failures.clear();
    },
  };
};

export const metaProfileCoordinator = createMetaProfileCoordinator();

// Resolve a promise or give up after `ms`, without cancelling the underlying work.
export const waitAtMost = (promise, ms, { onTimeout = null } = {}) => {
  const budget = Number(ms);
  if (!Number.isFinite(budget) || budget <= 0) return Promise.resolve({ settled: false, value: undefined });
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve({ settled: false, value: undefined });
    }, budget);
  });
  const settled = Promise.resolve(promise).then(
    (value) => ({ settled: true, value }),
    (error) => ({ settled: true, error })
  );
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
};

export const shortMetaIdTail = (value = "", length = 4) => {
  const id = text(value);
  if (!id) return "";
  return id.length <= length ? id : id.slice(-length);
};

// The one display-name order both inbox surfaces and the API follow:
// real profile name → stored name → username → the tail of the Meta user id.
export const resolveMetaCustomerDisplayName = ({
  profileName = "",
  storedName = "",
  username = "",
  externalCustomerId = "",
  channel = "",
  isStoredNameUsable = (value) => Boolean(text(value)) && !isMetaScopedUserId(value),
} = {}) => {
  const real = text(profileName);
  if (real && !isMetaScopedUserId(real)) return { name: real, source: "profile" };
  const stored = text(storedName);
  if (stored && isStoredNameUsable(stored)) return { name: stored, source: "stored" };
  const handle = text(username).replace(/^@/, "");
  if (handle) return { name: `@${handle}`, source: "username" };
  const tail = shortMetaIdTail(externalCustomerId);
  if (tail) {
    const normalizedChannel = normalizeMetaProfileChannel(channel);
    const label = normalizedChannel === META_PROFILE_CHANNELS.INSTAGRAM ? "Instagram" : normalizedChannel === META_PROFILE_CHANNELS.MESSENGER ? "Messenger" : "Meta";
    return { name: `${label} …${tail}`, source: "external_id" };
  }
  return { name: "", source: "none" };
};
