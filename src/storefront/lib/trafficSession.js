import { api } from "../../shared/api/api";
import {
  classifyTrafficSource,
  hasTrafficSignal,
  readTrafficParams,
  TRAFFIC_SESSION_IDLE_MS,
} from "../../../shared/trafficSource.js";

/**
 * The storefront half of sales channel analytics.
 *
 * A session is one visit, counted as GA4 counts them: it starts on the first page view,
 * ends after 30 idle minutes, and a landing from a different source (a new ad click, a
 * new utm campaign) starts a fresh one. The server classifies the source again from the
 * raw parameters sent here; this module only needs the label to notice a change.
 *
 * Nothing here may break the shop: storage can be blocked and the network can fail, so
 * every path degrades to "no session", and the order is then credited to unknown.
 */

const SESSION_STORAGE_KEY = "m1.traffic.session";
const VISITOR_STORAGE_KEY = "m1.traffic.visitor";

// document.referrer is the page that opened THIS page load. After a client-side route
// change it still names that page, so it is only read for the first touch of each load.
let landingConsumed = false;

const newKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

const readJson = (key) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the session lives for this call only.
  }
};

const visitorKey = () => {
  try {
    let key = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (!key) {
      key = newKey();
      window.localStorage.setItem(VISITOR_STORAGE_KEY, key);
    }
    return key;
  } catch {
    return "";
  }
};

const send = (body) =>
  api
    .post("/storefront/traffic/events", body, {
      keepalive: true,
      timeoutMs: 8000,
      suppressErrorStatuses: [400, 404, 429, 500, 502, 503, 504],
    })
    .then(() => true)
    .catch(() => false);

// Session starts still in flight, so a quick second page view does not send the same one again.
const pendingStarts = new Set();

const registerSession = (session, landing) => {
  if (pendingStarts.has(session.key)) return;
  pendingStarts.add(session.key);
  void send({
    type: "session_start",
    session_key: session.key,
    visitor_key: visitorKey(),
    params: landing.params,
    referrer: landing.referrer,
    landing_path: landing.path,
  }).then((ok) => {
    pendingStarts.delete(session.key);
    if (!ok) return;
    const stored = readJson(SESSION_STORAGE_KEY);
    if (stored?.key === session.key) writeJson(SESSION_STORAGE_KEY, { ...stored, registered: true, landing: null });
  });
};

/**
 * Called on every storefront page view. Opens a new session when the last one went idle
 * or the visitor arrived from a different source; otherwise just keeps it alive.
 */
export const touchTrafficSession = ({ search = "", path = "" } = {}) => {
  if (typeof window === "undefined") return null;
  const now = Date.now();
  const ownHost = window.location.hostname;
  const referrer = landingConsumed ? "" : String(document.referrer || "");
  landingConsumed = true;
  const params = readTrafficParams(search);
  const landing = { params, referrer, path: String(path || window.location.pathname || "/").slice(0, 500) };
  const signal = hasTrafficSignal(params, referrer, ownHost);
  const source = signal ? classifyTrafficSource({ params, referrer, ownHost }) : null;

  const stored = readJson(SESSION_STORAGE_KEY);
  const expired = !stored?.key || now - Number(stored.lastSeenAt || 0) > TRAFFIC_SESSION_IDLE_MS;
  const sourceChanged = Boolean(
    source && stored &&
      (source.channel !== stored.channel || source.medium !== stored.medium || (source.campaign || "") !== (stored.campaign || ""))
  );

  if (expired || sourceChanged) {
    const label = source || { channel: "direct", medium: "direct", campaign: "" };
    const session = {
      key: newKey(),
      channel: label.channel,
      medium: label.medium,
      campaign: label.campaign || "",
      startedAt: now,
      lastSeenAt: now,
      registered: false,
      // Kept until the server has the row, so a resend classifies the same landing.
      landing,
    };
    writeJson(SESSION_STORAGE_KEY, session);
    registerSession(session, landing);
    return session;
  }

  const session = { ...stored, lastSeenAt: now };
  writeJson(SESSION_STORAGE_KEY, session);
  // A start that never reached the server (offline, a deploy) is sent again; the server
  // keeps the first copy, so a repeat is harmless.
  if (!stored.registered && stored.landing) registerSession(session, stored.landing);
  return session;
};

export const trackTrafficAddToCart = (quantity = 1) => {
  if (typeof window === "undefined") return;
  const session = readJson(SESSION_STORAGE_KEY);
  if (!session?.key) return;
  writeJson(SESSION_STORAGE_KEY, { ...session, lastSeenAt: Date.now() });
  void send({ type: "add_to_cart", session_key: session.key, quantity: Math.max(1, Number(quantity) || 1) });
};

/**
 * What the checkout sends with the order. Deliberately does not open a new session: a
 * shopper who spent 40 minutes on the checkout form is still in the visit that brought them.
 */
export const trafficCheckoutPayload = () => {
  if (typeof window === "undefined") return {};
  const session = readJson(SESSION_STORAGE_KEY);
  return session?.key ? { session_key: session.key } : {};
};
