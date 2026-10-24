// Runs inside the ERP (erp.m1store-egy.com / jomla / localhost).
//
// The ERP's own Bosta card dispatches a window CustomEvent asking for a refresh;
// this bridges that to the background worker (which reads Bosta) and then saves
// the record back to the ERP API using the ERP page's own login token. Results
// are announced back to the page with another CustomEvent.

const ERP_TOKEN_KEYS = ["token", "authToken", "accessToken", "erp_token", "erp.saas.token"];

function erpToken() {
  for (const key of ERP_TOKEN_KEYS) {
    const v = localStorage.getItem(key);
    if (v) return v;
  }
  return null;
}

function erpApiBase() {
  const host = location.hostname.toLowerCase();
  if (host === "jomla.m1store-egy.com") return "https://api-jomla.m1store-egy.com/api";
  if (host.endsWith("m1store-egy.com")) return "https://api.m1store-egy.com/api";
  // dev: same-origin proxy if present, else local backend
  return `${location.origin}/api`;
}

function announce(detail) {
  window.dispatchEvent(new CustomEvent("erp:bosta-consignee-result", { detail }));
}

async function saveToErp(record) {
  const token = erpToken();
  const res = await fetch(`${erpApiBase()}/shipping/bosta/consignee-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(record),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.success === false)) {
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json?.data || record;
}

window.addEventListener("erp:bosta-consignee-fetch", (ev) => {
  const phone = ev?.detail?.phone;
  if (!phone) return;
  (async () => {
    let fetched;
    try {
      fetched = await chrome.runtime.sendMessage({ type: "FETCH_BOSTA", phone });
    } catch (e) {
      announce({ ok: false, phone, error: "EXTENSION_UNAVAILABLE" });
      return;
    }
    if (!fetched || !fetched.ok) {
      announce({ ok: false, phone, error: fetched?.error || "FETCH_FAILED" });
      return;
    }
    try {
      const saved = await saveToErp(fetched.data);
      announce({ ok: true, phone, saved: true, record: saved });
    } catch (e) {
      // We still got the data; surface it even if the save failed.
      announce({ ok: false, phone, saved: false, record: fetched.data, error: `SAVE_FAILED:${e.message}` });
    }
  })();
});

// Let the card know the extension is present (so it can enable its button).
function announceReady() {
  window.dispatchEvent(new CustomEvent("erp:bosta-extension-ready"));
}
window.addEventListener("erp:bosta-extension-ping", announceReady);
announceReady();
