// Runs inside the logged-in Bosta dashboard tab (business.bosta.co).
//
// When the background worker asks for a consignee record, this reads the
// dashboard's own session token from this origin's localStorage and calls
// Bosta's own API — exactly what the dashboard does when you type a phone into
// the create-order form. The token NEVER leaves this page: only the resulting
// delivery counts are returned.

const BOSTA_API = "https://app.bosta.co/api/v2";

function readBostaToken() {
  // The SPA keeps the session JWT in localStorage. userInfo.token is the primary
  // slot; newToken is the refreshed copy. Either works as the Authorization value.
  try {
    const info = JSON.parse(localStorage.getItem("userInfo") || "null");
    if (info && info.token) return info.token;
  } catch (_) { /* ignore malformed */ }
  const fresh = localStorage.getItem("newToken");
  if (fresh) return fresh;
  return null;
}

// Egyptian-friendly E.164: 01024960585 -> +201024960585
function toE164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("20")) return "+" + d;
  if (d.startsWith("0")) return "+20" + d.slice(1);
  if (d.startsWith("1") && d.length === 10) return "+20" + d;
  return "+" + d;
}

async function fetchConsignee(phoneInput) {
  const token = readBostaToken();
  if (!token) return { ok: false, error: "NO_BOSTA_LOGIN" };

  const phone = toE164(phoneInput);
  const headers = { Authorization: token, Accept: "application/json" };

  const rankRes = await fetch(
    `${BOSTA_API}/consignee/ranking?phone=${encodeURIComponent(phone)}&includeRejectedDeliveries=true`,
    { headers }
  );
  if (rankRes.status === 401 || rankRes.status === 403) {
    return { ok: false, error: "BOSTA_UNAUTHORIZED" };
  }
  const rankJson = await rankRes.json().catch(() => null);
  if (!rankRes.ok || !rankJson || rankJson.success === false) {
    return { ok: false, error: `BOSTA_HTTP_${rankRes.status}` };
  }

  // Best-effort name from the merchant's own saved address book.
  let fullName = "";
  try {
    const relRes = await fetch(`${BOSTA_API}/consignee/relativeBusinessData`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ phone, isCompletePhoneNumber: true, countryCode: "EG" }),
    });
    const relJson = await relRes.json().catch(() => null);
    fullName = relJson?.data?.[0]?.fullName || "";
  } catch (_) { /* name is optional */ }

  const r = rankJson?.data?.consigneRanking || {};
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
      raw: rankJson?.data ?? null,
    },
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "BOSTA_RANKING") return;
  fetchConsignee(msg.phone)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // keep the channel open for the async response
});
