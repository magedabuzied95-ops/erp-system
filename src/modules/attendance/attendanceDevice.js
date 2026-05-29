const STORAGE_KEY = "erp.attendance.deviceToken";
const FINGERPRINT_KEY = "erp.attendance.deviceFingerprint";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

const getCookieValue = (key) => {
  if (typeof document === "undefined") return "";
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}=`))
    ?.slice(key.length + 1) || "";
};

const setCookieValue = (key, value) => {
  if (typeof document === "undefined") return;
  document.cookie = `${key}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE_SECONDS}; path=/; samesite=lax`;
};

const toBase64Url = (bytes) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const createDeviceToken = () => {
  const bytes = new Uint8Array(48);
  window.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

const hashToToken = (value = "") => {
  let hashA = 0x811c9dc5;
  let hashB = 0x45d9f3b;
  let hashC = 0x9e3779b9;
  let hashD = 0x85ebca6b;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ code, 0x27d4eb2d) >>> 0;
    hashC = Math.imul(hashC + code + index, 0x165667b1) >>> 0;
    hashD = Math.imul(hashD ^ (code << (index % 8)), 0xc2b2ae35) >>> 0;
  }
  return `${hashA.toString(36)}${hashB.toString(36)}${hashC.toString(36)}${hashD.toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "");
};

const getBrowserFingerprintParts = () => {
  if (typeof window === "undefined") return [];
  const nav = window.navigator || {};
  const screenInfo = window.screen || {};
  return [
    nav.userAgent || "",
    nav.language || "",
    Array.isArray(nav.languages) ? nav.languages.join(",") : "",
    nav.platform || "",
    String(nav.hardwareConcurrency || ""),
    String(nav.deviceMemory || ""),
    String(screenInfo.width || ""),
    String(screenInfo.height || ""),
    String(screenInfo.colorDepth || ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  ];
};

export const getAttendanceDeviceToken = () => {
  if (typeof window === "undefined" || !window.localStorage || !window.crypto?.getRandomValues) {
    return decodeURIComponent(getCookieValue(STORAGE_KEY) || "");
  }

  const cookieToken = decodeURIComponent(getCookieValue(STORAGE_KEY) || "");
  const existing = window.localStorage.getItem(STORAGE_KEY) || cookieToken;
  if (existing && /^[A-Za-z0-9_-]{32,256}$/.test(existing)) {
    window.localStorage.setItem(STORAGE_KEY, existing);
    setCookieValue(STORAGE_KEY, existing);
    return existing;
  }

  const token = createDeviceToken();
  window.localStorage.setItem(STORAGE_KEY, token);
  setCookieValue(STORAGE_KEY, token);
  return token;
};

export const getAttendanceDeviceFingerprint = () => {
  if (typeof window === "undefined" || !window.localStorage || !window.crypto?.getRandomValues) {
    return decodeURIComponent(getCookieValue(FINGERPRINT_KEY) || "");
  }

  const deviceToken = getAttendanceDeviceToken();
  const cookieFingerprint = decodeURIComponent(getCookieValue(FINGERPRINT_KEY) || "");
  const existing = window.localStorage.getItem(FINGERPRINT_KEY) || cookieFingerprint;
  if (existing && existing.startsWith("device_") && /^[A-Za-z0-9_-]{32,256}$/.test(existing)) {
    window.localStorage.setItem(FINGERPRINT_KEY, existing);
    setCookieValue(FINGERPRINT_KEY, existing);
    return existing;
  }

  const browserHash = hashToToken(getBrowserFingerprintParts().join("|"));
  const fingerprint = `device_${deviceToken}_${browserHash}`.slice(0, 256);
  window.localStorage.setItem(FINGERPRINT_KEY, fingerprint);
  setCookieValue(FINGERPRINT_KEY, fingerprint);
  return fingerprint;
};

export const rotateAttendanceDeviceToken = () => {
  if (typeof window === "undefined" || !window.localStorage || !window.crypto?.getRandomValues) {
    return "";
  }
  const token = createDeviceToken();
  window.localStorage.setItem(STORAGE_KEY, token);
  setCookieValue(STORAGE_KEY, token);
  window.localStorage.removeItem(FINGERPRINT_KEY);
  setCookieValue(FINGERPRINT_KEY, "");
  return token;
};
