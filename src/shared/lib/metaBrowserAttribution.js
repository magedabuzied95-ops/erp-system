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

export const captureMetaBrowserIdentity = () => {
  if (typeof window === "undefined") return {};
  const fbclid = new URLSearchParams(window.location.search).get("fbclid") || "";
  let fbc = cookieValue("_fbc");
  if (!fbc && fbclid) {
    fbc = `fb.1.${Date.now()}.${fbclid}`;
    document.cookie = `_fbc=${encodeURIComponent(fbc)}; Max-Age=7776000; Path=/; SameSite=Lax; Secure`;
  }
  return {
    fbp: decodeCookieValue(cookieValue("_fbp")),
    fbc: decodeCookieValue(fbc),
  };
};
