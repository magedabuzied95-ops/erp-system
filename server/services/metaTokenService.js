const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const trimString = (value) => String(value || "").trim();
const nullableString = (value) => {
  const normalized = trimString(value);
  return normalized || null;
};

const getMetaAppConfig = () => {
  const appId = trimString(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID);
  const appSecret = trimString(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET);
  return { appId, appSecret };
};

const parseMetaResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getMetaErrorMessage = (payload, fallback = "Meta token request failed") => {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.error) return JSON.stringify(payload.error);
  if (payload?.message) return payload.message;
  return fallback;
};

const callMetaGet = async ({ path, params, label }) => {
  const target = new URL(`${GRAPH_API_BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    const normalized = nullableString(value);
    if (normalized !== null) target.searchParams.set(key, normalized);
  });

  const safeTarget = target
    .toString()
    .replace(/(access_token|client_secret|fb_exchange_token)=[^&]+/g, "$1=***");
  console.log("[meta-token] request", { target: safeTarget, label });
  const response = await fetch(target);
  const payload = await parseMetaResponse(response);

  if (response.ok) {
    console.log("[meta-token] response", { label, status: response.status, response: { ...payload, access_token: payload?.access_token ? "***" : undefined } });
    return payload;
  }

  console.error("[meta-token] error", { label, status: response.status, response: payload });
  const error = new Error(getMetaErrorMessage(payload));
  error.status = response.status;
  error.metaResponse = payload;
  throw error;
};

const expiresAtFromSeconds = (seconds) => {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(Date.now() + parsed * 1000).toISOString();
};

const exchangeShortLivedUserToken = async (shortLivedUserToken) => {
  const { appId, appSecret } = getMetaAppConfig();
  if (!appId || !appSecret) {
    const error = new Error("Meta app credentials are not configured. Set META_APP_ID and META_APP_SECRET, then reconnect Meta.");
    error.status = 400;
    throw error;
  }

  const payload = await callMetaGet({
    path: "/oauth/access_token",
    label: "exchange_short_lived_user_token",
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedUserToken,
    },
  });

  const accessToken = nullableString(payload?.access_token);
  if (!accessToken) {
    const error = new Error("Meta did not return a long-lived user token.");
    error.status = 502;
    error.metaResponse = payload;
    throw error;
  }

  return {
    accessToken,
    expiresAt: expiresAtFromSeconds(payload?.expires_in),
    raw: payload,
  };
};

const refreshLongLivedUserToken = async (longLivedUserToken) => {
  const { appId, appSecret } = getMetaAppConfig();
  if (!appId || !appSecret) {
    const error = new Error("Meta app credentials are not configured. Set META_APP_ID and META_APP_SECRET.");
    error.status = 400;
    throw error;
  }

  const payload = await callMetaGet({
    path: "/oauth/access_token",
    label: "refresh_long_lived_user_token",
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: longLivedUserToken,
    },
  });

  const accessToken = nullableString(payload?.access_token);
  if (!accessToken) {
    const error = new Error("Meta did not return a refreshed long-lived user token.");
    error.status = 502;
    error.metaResponse = payload;
    throw error;
  }

  return {
    accessToken,
    expiresAt: expiresAtFromSeconds(payload?.expires_in),
    raw: payload,
  };
};

const findPageAccount = (accounts = [], pageId) => {
  const requestedPageId = nullableString(pageId);
  if (requestedPageId) {
    return accounts.find((account) => trimString(account?.id) === requestedPageId) || null;
  }
  return accounts[0] || null;
};

export const refreshMetaTokens = async ({ shortLivedUserToken, longLivedUserToken, pageId } = {}) => {
  const submittedToken = nullableString(shortLivedUserToken);
  const existingLongLivedToken = nullableString(longLivedUserToken);

  if (!submittedToken && !existingLongLivedToken) {
    const error = new Error("A Meta user access token is required to reconnect.");
    error.status = 400;
    throw error;
  }

  const userTokenResult = submittedToken
    ? await exchangeShortLivedUserToken(submittedToken)
    : { accessToken: existingLongLivedToken, expiresAt: null, raw: null };

  const accountsPayload = await callMetaGet({
    path: "/me/accounts",
    label: "retrieve_page_access_token",
    params: {
      fields: "id,name,access_token",
      access_token: userTokenResult.accessToken,
    },
  });

  const accounts = Array.isArray(accountsPayload?.data) ? accountsPayload.data : [];
  const pageAccount = findPageAccount(accounts, pageId);
  if (!pageAccount) {
    const error = new Error(pageId ? `Meta user token does not have access to Facebook Page ${pageId}.` : "Meta user token did not return any Facebook Pages.");
    error.status = 400;
    error.metaResponse = accountsPayload;
    throw error;
  }

  const pageAccessToken = nullableString(pageAccount?.access_token);
  if (!pageAccessToken) {
    const error = new Error("Meta did not return a Page access token for the selected Facebook Page.");
    error.status = 502;
    error.metaResponse = pageAccount;
    throw error;
  }

  return {
    longLivedUserToken: userTokenResult.accessToken,
    pageAccessToken,
    pageId: trimString(pageAccount.id),
    pageName: trimString(pageAccount.name),
    tokenExpiresAt: userTokenResult.expiresAt,
    raw: {
      exchange: userTokenResult.raw,
      accounts: accountsPayload,
    },
  };
};

export const refreshLongLivedMetaToken = async ({ longLivedUserToken, pageId } = {}) => {
  const submittedToken = nullableString(longLivedUserToken);
  if (!submittedToken) {
    const error = new Error("A Meta long-lived user token is required to refresh.");
    error.status = 400;
    throw error;
  }

  const userTokenResult = await refreshLongLivedUserToken(submittedToken);

  const accountsPayload = await callMetaGet({
    path: "/me/accounts",
    label: "refresh_page_access_token",
    params: {
      fields: "id,name,access_token",
      access_token: userTokenResult.accessToken,
    },
  });

  const accounts = Array.isArray(accountsPayload?.data) ? accountsPayload.data : [];
  const pageAccount = findPageAccount(accounts, pageId);
  if (!pageAccount) {
    const error = new Error(pageId ? `Meta user token does not have access to Facebook Page ${pageId}.` : "Meta user token did not return any Facebook Pages.");
    error.status = 400;
    error.metaResponse = accountsPayload;
    throw error;
  }

  const pageAccessToken = nullableString(pageAccount?.access_token);
  if (!pageAccessToken) {
    const error = new Error("Meta did not return a Page access token for the selected Facebook Page.");
    error.status = 502;
    error.metaResponse = pageAccount;
    throw error;
  }

  return {
    longLivedUserToken: userTokenResult.accessToken,
    pageAccessToken,
    pageId: trimString(pageAccount.id),
    pageName: trimString(pageAccount.name),
    tokenExpiresAt: userTokenResult.expiresAt,
    raw: {
      refresh: userTokenResult.raw,
      accounts: accountsPayload,
    },
  };
};

export const getPublishingAccessToken = (settings = {}) =>
  trimString(settings.page_access_token || settings.access_token || settings.access_token_encrypted);

export const getMetaTokenStatus = (settings = {}) => {
  const token = getPublishingAccessToken(settings);
  if (!token) return { status: "missing", valid: false, error: "Meta Page access token is not connected." };

  const expiresAt = settings.token_expires_at ? new Date(settings.token_expires_at) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return { status: settings.page_access_token ? "active" : "legacy", valid: true, warning: "Token expiration is unknown. Reconnect Meta to save a long-lived token expiry." };
  }

  const msUntilExpiry = expiresAt.getTime() - Date.now();
  if (msUntilExpiry <= 0) {
    return { status: "expired", valid: false, error: "Meta access token has expired. Reconnect Meta before publishing." };
  }

  const warningWindowMs = 7 * 24 * 60 * 60 * 1000;
  if (msUntilExpiry <= warningWindowMs) {
    return { status: "expiring_soon", valid: true, warning: "Meta access token expires soon. Reconnect Meta to avoid scheduled publish failures." };
  }

  return { status: "active", valid: true };
};

export const validateMetaToken = (settings = {}) => {
  const accessToken = getPublishingAccessToken(settings);
  const status = getMetaTokenStatus(settings);
  if (!status.valid) {
    const error = new Error(status.error || "Meta access token is not valid.");
    error.status = 400;
    error.tokenStatus = status.status;
    throw error;
  }
  return { accessToken, ...status };
};
