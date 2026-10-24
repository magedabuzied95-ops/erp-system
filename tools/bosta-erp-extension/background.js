// Relays a consignee lookup from the ERP page (or the popup) to the Bosta
// dashboard, opening a Bosta tab in the background if none is open.
//
// Instead of a declarative content script + tab messaging (which is flaky when
// Chrome discards background tabs), the lookup is injected fresh into the Bosta
// tab with chrome.scripting on each request. The injected function reads the
// dashboard's own session token from that tab's localStorage and calls Bosta's
// API — the token never leaves that tab; only the counts are returned.

const BOSTA_TAB_GLOB = "https://business.bosta.co/*";
const BOSTA_OPEN_URL = "https://business.bosta.co/overview";

function waitForComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getBostaTab() {
  const open = await chrome.tabs.query({ url: BOSTA_TAB_GLOB });
  // Prefer a fully loaded tab if there is one.
  const ready = open.find((t) => t.status === "complete");
  if (ready) return ready;
  if (open.length) {
    await waitForComplete(open[0].id);
    return open[0];
  }
  const tab = await chrome.tabs.create({ url: BOSTA_OPEN_URL, active: false });
  await waitForComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1200));
  return tab;
}

// Runs INSIDE the Bosta tab (isolated world: shares localStorage, and the
// extension's host permissions let it call app.bosta.co).
async function fetchConsigneeInBostaTab(phoneInput) {
  function readToken() {
    try {
      const u = JSON.parse(localStorage.getItem("userInfo") || "null");
      if (u && u.token) return u.token;
    } catch (e) { /* ignore */ }
    return localStorage.getItem("newToken");
  }
  function toE164(p) {
    const d = String(p || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("20")) return "+" + d;
    if (d.startsWith("0")) return "+20" + d.slice(1);
    if (d.startsWith("1") && d.length === 10) return "+20" + d;
    return "+" + d;
  }
  const token = readToken();
  if (!token) return { ok: false, error: "NO_BOSTA_LOGIN" };
  const phone = toE164(phoneInput);
  const base = "https://app.bosta.co/api/v2";
  const headers = { Authorization: token, Accept: "application/json" };
  const rankRes = await fetch(
    `${base}/consignee/ranking?phone=${encodeURIComponent(phone)}&includeRejectedDeliveries=true`,
    { headers }
  );
  if (rankRes.status === 401 || rankRes.status === 403) return { ok: false, error: "BOSTA_UNAUTHORIZED" };
  const rankJson = await rankRes.json().catch(() => null);
  if (!rankRes.ok || !rankJson || rankJson.success === false) return { ok: false, error: `BOSTA_HTTP_${rankRes.status}` };
  let fullName = "";
  try {
    const relRes = await fetch(`${base}/consignee/relativeBusinessData`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ phone, isCompletePhoneNumber: true, countryCode: "EG" }),
    });
    const relJson = await relRes.json().catch(() => null);
    fullName = (relJson && relJson.data && relJson.data[0] && relJson.data[0].fullName) || "";
  } catch (e) { /* name optional */ }
  const r = (rankJson.data && rankJson.data.consigneRanking) || {};
  return {
    ok: true,
    data: {
      phone,
      full_name: fullName,
      delivered: r.deliveredDeliveriesCount ?? null,
      returned: r.returnedDeliveriesCount ?? null,
      consecutive_returned: r.consecutiveReturnedDeliveriesCount ?? null,
      success_rate: r.deliverySuccessRate ?? null,
      high_unpaid_returns: r.hasHighUnpaidFlexshipReturns ?? null,
      raw: rankJson.data ?? null,
    },
  };
}

async function askBosta(phone) {
  const tab = await getBostaTab();
  if (!tab || !tab.id) return { ok: false, error: "NO_BOSTA_TAB" };
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchConsigneeInBostaTab,
      args: [phone],
    });
  } catch (e) {
    return { ok: false, error: "BOSTA_INJECT_FAILED" };
  }
  const out = results && results[0] && results[0].result;
  return out || { ok: false, error: "NO_RESULT" };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "FETCH_BOSTA") return;
  if (!msg.phone) {
    sendResponse({ ok: false, error: "PHONE_REQUIRED" });
    return;
  }
  askBosta(msg.phone)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async
});
