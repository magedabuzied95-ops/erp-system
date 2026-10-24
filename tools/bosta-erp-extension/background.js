// Relays a consignee lookup from the ERP page (or the popup) to the Bosta
// dashboard tab, opening one in the background if none is open.

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
  if (open.length) return { tab: open[0], opened: false };
  const tab = await chrome.tabs.create({ url: BOSTA_OPEN_URL, active: false });
  await waitForComplete(tab.id);
  // The SPA + content script need a breath after "complete".
  await new Promise((r) => setTimeout(r, 1800));
  return { tab, opened: true };
}

async function askBosta(phone) {
  const { tab, opened } = await getBostaTab();
  if (!tab || !tab.id) return { ok: false, error: "NO_BOSTA_TAB" };
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "BOSTA_RANKING", phone });
    return res || { ok: false, error: "NO_RESPONSE" };
  } catch (e) {
    // Content script not injected yet (freshly opened tab). Retry once.
    if (opened) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const res2 = await chrome.tabs.sendMessage(tab.id, { type: "BOSTA_RANKING", phone });
        return res2 || { ok: false, error: "NO_RESPONSE" };
      } catch (e2) {
        return { ok: false, error: "BOSTA_TAB_NOT_READY" };
      }
    }
    return { ok: false, error: "BOSTA_TAB_NOT_READY" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "FETCH_BOSTA") return;
  if (!msg.phone) {
    sendResponse({ ok: false, error: "PHONE_REQUIRED" });
    return; // sync response
  }
  askBosta(msg.phone)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async
});
