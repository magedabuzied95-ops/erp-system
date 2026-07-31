const cookieValue = (name = "") => {
  if (typeof document === "undefined") return "";
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
};

const decodeCookieValue = (value = "") => {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return "";
  }
};

const META_VISITOR_ID_KEY = "m1.meta.visitor_id";
const META_VISITOR_COOKIE = "_m1_meta_vid";
const META_COOKIE_MAX_AGE = 7776000;

const randomToken = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
};

const setFirstPartyCookie = (name, value) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${META_COOKIE_MAX_AGE}; Path=/; SameSite=Lax; Secure`;
};

const metaVisitorId = () => {
  const cookieId = decodeCookieValue(cookieValue(META_VISITOR_COOKIE));
  let storedId = "";
  try {
    storedId = window.localStorage.getItem(META_VISITOR_ID_KEY) || "";
  } catch {
    storedId = "";
  }
  const visitorId = cookieId || storedId || randomToken();
  if (!cookieId) setFirstPartyCookie(META_VISITOR_COOKIE, visitorId);
  if (!storedId) {
    try {
      window.localStorage.setItem(META_VISITOR_ID_KEY, visitorId);
    } catch {
      // The first-party cookie still provides a stable identifier.
    }
  }
  return visitorId;
};

const metaBrowserId = () => {
  const existing = decodeCookieValue(cookieValue("_fbp"));
  if (existing) return existing;
  const generated = `fb.1.${Date.now()}.${randomToken().replace(/\D/g, "").slice(0, 16) || Date.now()}`;
  setFirstPartyCookie("_fbp", generated);
  return generated;
};

export const captureMetaBrowserIdentity = () => {
  if (typeof window === "undefined") return {};
  const fbclid = new URLSearchParams(window.location.search).get("fbclid") || "";
  let fbc = decodeCookieValue(cookieValue("_fbc"));
  if (!fbc && fbclid) {
    fbc = `fb.1.${Date.now()}.${fbclid}`;
    setFirstPartyCookie("_fbc", fbc);
  }
  return {
    fbp: metaBrowserId(),
    fbc,
    externalId: metaVisitorId(),
  };
};
