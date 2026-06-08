import axios from "axios";

const trim = (value = "") => String(value ?? "").trim();

const normalizeBaseUrl = (value = "") => trim(value).replace(/\/+$/g, "");

const config = () => {
  const apiUrl = normalizeBaseUrl(process.env.EVOLUTION_API_URL);
  const apiKey = trim(process.env.EVOLUTION_API_KEY);
  const instanceName = trim(process.env.EVOLUTION_INSTANCE_NAME);
  const publicUrl = normalizeBaseUrl(process.env.WEBHOOK_PUBLIC_URL);
  return {
    apiUrl,
    apiKey,
    instanceName,
    publicUrl,
    webhookUrl: publicUrl ? `${publicUrl}/api/whatsapp/webhook` : "",
  };
};

const hasRequiredConfig = (current = config()) =>
  Boolean(current.apiUrl && current.apiKey && current.instanceName && current.publicUrl);

const logFullError = (label, error = {}) => {
  console.error(label, {
    name: error?.name || "",
    message: error?.message || String(error),
    stack: error?.stack || "",
    cause: error?.cause
      ? {
          name: error.cause?.name || "",
          message: error.cause?.message || String(error.cause),
          stack: error.cause?.stack || "",
        }
      : null,
    status: error?.status || "",
    code: error?.code || "",
    errno: error?.errno || "",
    syscall: error?.syscall || "",
    address: error?.address || "",
    port: error?.port || "",
    data: error?.data || null,
    url: error?.url || "",
  });
};

const requestWithFetch = async (url, current, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: current.apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Evolution API returned ${response.status}`);
    error.status = response.status;
    error.data = data;
    error.url = url;
    throw error;
  }
  return data;
};

const requestWithAxios = async (url, current, options = {}) => {
  const response = await axios.request({
    url,
    method: options.method || "GET",
    headers: {
      apikey: current.apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    data: options.body ? JSON.parse(options.body) : undefined,
    validateStatus: () => true,
    timeout: Number(process.env.EVOLUTION_REQUEST_TIMEOUT_MS || 10_000),
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(response.data?.message || response.data?.error || `Evolution API returned ${response.status}`);
    error.status = response.status;
    error.data = response.data;
    error.url = url;
    throw error;
  }
  return response.data;
};

const evolutionRequest = async (path, options = {}) => {
  const current = config();
  const url = `${current.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
  console.log("[evolution-webhook-sync:request-url]", {
    method: options.method || "GET",
    url,
  });
  try {
    return await requestWithFetch(url, current, options);
  } catch (error) {
    console.warn("[evolution-webhook-sync:fetch-failed]", {
      url,
      message: error?.message || String(error),
    });
    logFullError("[evolution-webhook-sync:fetch-error]", error);
    console.log("[evolution-webhook-sync:axios-fallback]", { url });
    try {
      return await requestWithAxios(url, current, options);
    } catch (axiosError) {
      logFullError("[evolution-webhook-sync:axios-error]", axiosError);
      throw axiosError;
    }
  }
};

const normalizeWebhookResponse = (response = {}) => ({
  message: response?.message ?? "",
  errors: response?.errors ?? response?.error ?? null,
  validation: response?.validation ?? null,
  raw: response ?? null,
});

const logWebhookResponse = (label, response = {}) => {
  const normalized = normalizeWebhookResponse(response);
  console.log(label, {
    message: normalized.message,
    errors: normalized.errors,
    validation: normalized.validation,
    raw: normalized.raw,
  });
};

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const findInstanceRecord = (payload, instanceName) => {
  const candidates = [];
  if (Array.isArray(payload)) candidates.push(...payload);
  if (payload && typeof payload === "object") {
    for (const key of ["instance", "data", "response", "result", "details"]) {
      candidates.push(...asArray(payload[key]));
    }
    candidates.push(payload);
  }
  const target = trim(instanceName).toLowerCase();
  return candidates.find((entry) => {
    const name = trim(entry?.instanceName || entry?.name || entry?.instance || entry?.instance_name || entry?.id).toLowerCase();
    return name === target;
  }) || null;
};

const readWebhookSnapshot = (instance = {}) => ({
  enabled: Boolean(
    instance?.webhook_enabled ??
    instance?.webhookEnabled ??
    instance?.webhook?.enabled ??
    instance?.webhook?.active ??
    (instance?.webhook?.status === "enabled" ||
      instance?.webhook?.status === "active")
  ),
  url: trim(
    instance?.webhook_url ??
    instance?.webhookUrl ??
    instance?.webhook?.url ??
    instance?.webhook?.webhook_url ??
    instance?.webhook?.webhookUrl
  ),
  events: asArray(
    instance?.webhook_events ??
    instance?.webhookEvents ??
    instance?.webhook?.events ??
    instance?.webhook?.subscribed_events ??
    instance?.webhook?.message_events
  ).map((event) => trim(event)).filter(Boolean),
  raw: instance?.webhook || null,
});

const webhookMatches = (currentUrl = "", snapshot = {}) => {
  const normalizedCurrent = normalizeBaseUrl(currentUrl);
  const normalizedSnapshot = normalizeBaseUrl(snapshot.url);
  return Boolean(normalizedCurrent && normalizedSnapshot && normalizedCurrent === normalizedSnapshot && snapshot.enabled);
};

const webhookFind = async (current) => {
  const findPaths = [
    `/webhook/find/${encodeURIComponent(current.instanceName)}`,
    `/webhook/instance/${encodeURIComponent(current.instanceName)}`,
  ];
  let lastError = null;
  for (const path of findPaths) {
    try {
      return await evolutionRequest(path, { method: "GET" });
    } catch (error) {
      lastError = error;
      if (![404, 405].includes(Number(error?.status))) break;
    }
  }
  throw lastError || new Error("Unable to read Evolution webhook");
};

export const getEvolutionInstanceEventsDebug = async () => {
  const current = config();
  const instancesPayload = await evolutionRequest("/instance/fetchInstances", { method: "GET" });
  const instance = findInstanceRecord(instancesPayload, current.instanceName);
  if (!instance) {
    throw new Error(`Evolution instance not found: ${current.instanceName}`);
  }
  const webhook = await webhookFind(current);
  console.log("[evolution-webhook-sync:webhook-find-response]", webhook);
  const debug = {
    instance_name: current.instanceName,
    instance_status: instance?.status || instance?.state || instance?.connectionState || "unknown",
    webhook_enabled: Boolean(webhook?.enabled),
    webhook_url: String(webhook?.url || "").trim(),
    webhook_events: normalizeEventList(webhook?.events),
    required_webhook_events: requiredWebhookEvents,
    missing_required_webhook_events: missingRequiredEvents(webhook?.events),
    webhook_record_id: webhookRecordIdFrom(webhook) || "",
    instance_webhook_fields: Object.fromEntries(Object.entries(instance).filter(([key]) => /webhook/i.test(key))),
    raw_webhook_find: webhook,
  };
  console.log("[evolution-instance-events]", debug);
  return debug;
};

const logWebhookFieldsFromInstance = (instance = {}) => {
  const webhookFields = Object.fromEntries(
    Object.entries(instance).filter(([key]) => /webhook/i.test(key))
  );
  console.log("[evolution-webhook-sync:instance-webhook-fields]", {
    keys: Object.keys(webhookFields),
    fields: webhookFields,
  });
};

const logCandidateWebhookRoutes = (discovered = []) => {
  const candidates = [];
  for (const entry of discovered) {
    const payload = entry?.response;
    if (!payload || typeof payload !== "object") continue;
    const values = [
      payload?.routes,
      payload?.endpoints,
      payload?.paths,
      payload?.availableRoutes,
      payload?.webhookRoutes,
      payload?.webhook_routes,
      payload?.route,
      payload?.path,
    ];
    for (const value of values) {
      if (Array.isArray(value)) {
        candidates.push(...value.map((item) => String(item)));
      } else if (typeof value === "string") {
        candidates.push(value);
      }
    }
  }
  const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
  console.log("[evolution-webhook-sync:candidate-webhook-routes]", {
    candidates: uniqueCandidates,
  });
};

const webhookRecordIdFrom = (record = {}) =>
  record?.id ??
  record?.webhookId ??
  record?.webhook_id ??
  record?.data?.id ??
  record?.data?.webhookId ??
  record?.webhook?.id ??
  "";

const normalizeEventList = (value = []) =>
  asArray(value)
    .map((event) => String(event || "").trim())
    .filter(Boolean);

const requiredWebhookEvents = [
  "MESSAGES_SET",
  "MESSAGES_UPSERT",
  "MESSAGES_EDITED",
  "MESSAGES_UPDATE",
  "MESSAGES_DELETE",
  "SEND_MESSAGE",
  "SEND_MESSAGE_UPDATE",
  "CONTACTS_SET",
  "CONTACTS_UPSERT",
  "CONTACTS_UPDATE",
  "CHATS_SET",
  "CHATS_UPSERT",
  "CHATS_UPDATE",
  "CHATS_DELETE",
  "PRESENCE_UPDATE",
  "CONNECTION_UPDATE",
];

const missingRequiredEvents = (events = []) => {
  const normalized = normalizeEventList(events).map((event) => event.toUpperCase());
  return requiredWebhookEvents.filter((event) => !normalized.includes(event));
};

const hasAllRequiredEvents = (events = []) => {
  return missingRequiredEvents(events).length === 0;
};

const readWebhookRecord = async (current) => {
  const webhook = await webhookFind(current);
  logWebhookResponse("[evolution-webhook-sync:webhook-response]", webhook);
  return webhook;
};

const updateWebhookByRecordId = async ({ current, webhookRecord, desiredUrl }) => {
  const webhookId = webhookRecordIdFrom(webhookRecord);
  const updateBody = {
    enabled: true,
    url: desiredUrl,
    events: requiredWebhookEvents,
    webhook_by_events: false,
    webhook_base64: false,
  };

  const updateCandidates = [
    "/webhook/instance",
    "/webhook/instance/",
    `/webhook/instance/${encodeURIComponent(current.instanceName)}`,
  ].filter(Boolean);

  let lastError = null;
  for (const path of updateCandidates) {
    console.log("[evolution-webhook-sync:webhook-payload]", {
      url: path,
      body: updateBody,
      webhook_record_id: webhookId || "",
    });
    try {
      const response = await evolutionRequest(path, {
        method: "POST",
        body: JSON.stringify(updateBody),
      });
      logWebhookResponse("[evolution-webhook-sync:webhook-response]", response);
      return { response, path, webhookId };
    } catch (error) {
      lastError = error;
      logWebhookResponse("[evolution-webhook-sync:webhook-response]", error?.data || {});
    }
  }

  const error = lastError || new Error("Unable to update Evolution webhook");
  error.recreateInstruction = `If Evolution rejects /webhook/instance, recreate qr-test2 after setting WEBHOOK_GLOBAL_URL=${desiredUrl} and restart the instance/container.`;
  throw error;
};

export const syncEvolutionWebhookOnStartup = async () => {
  const current = config();
  console.log("[evolution-webhook-sync:start]", {
    has_api_url: Boolean(current.apiUrl),
    has_api_key: Boolean(current.apiKey),
    has_instance_name: Boolean(current.instanceName),
    has_public_url: Boolean(current.publicUrl),
    webhook_url: current.webhookUrl || "missing",
  });
  console.log("[evolution-webhook-sync:env]", {
    EVOLUTION_API_URL: current.apiUrl || "missing",
    EVOLUTION_INSTANCE_NAME: current.instanceName || "missing",
  });

  if (!hasRequiredConfig(current)) {
    return { skipped: true, reason: "missing_configuration" };
  }

  try {
    const baseUrlsToTest = [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      current.apiUrl,
    ].filter(Boolean);
    for (const baseUrl of baseUrlsToTest) {
      const normalized = normalizeBaseUrl(baseUrl);
      try {
        console.log("[evolution-webhook-sync:base-url-test]", { baseUrl: normalized });
        await requestWithFetch(normalized, current, { method: "GET" });
        console.log("[evolution-webhook-sync:base-url-ok]", { baseUrl: normalized });
      } catch (error) {
        console.warn("[evolution-webhook-sync:base-url-failed]", {
          baseUrl: normalized,
          message: error?.message || String(error),
        });
        logFullError("[evolution-webhook-sync:base-url-error]", error);
      }
    }

    console.log("[evolution-webhook-sync:node-fetch]", {
      available: typeof fetch === "function",
      implementation: typeof fetch === "function" ? String(fetch).slice(0, 80) : "missing",
    });
    const instancesPayload = await evolutionRequest("/instance/fetchInstances", { method: "GET" });
    const instance = findInstanceRecord(instancesPayload, current.instanceName);
    if (!instance) {
      throw new Error(`Evolution instance not found: ${current.instanceName}`);
    }

    console.log("[evolution-webhook-sync:instance-found]", {
      instanceName: current.instanceName,
      instance_status: instance?.status || instance?.state || instance?.connectionState || "unknown",
    });

    logWebhookFieldsFromInstance(instance);

    const currentWebhook = await readWebhookRecord(current);
    logCandidateWebhookRoutes([{ response: currentWebhook }]);

    const desiredUrl = current.webhookUrl;
    const currentUrl = String(currentWebhook?.url || "").trim();
    console.log("[evolution-webhook-sync:webhook-current]", {
      instanceName: current.instanceName,
      webhook_url: currentUrl || "missing",
      webhook_enabled: Boolean(currentWebhook?.enabled),
      webhook_events: normalizeEventList(currentWebhook?.events),
      desired_webhook_url: desiredUrl,
      required_webhook_events: requiredWebhookEvents,
      missing_required_webhook_events: missingRequiredEvents(currentWebhook?.events),
      webhook_record_id: webhookRecordIdFrom(currentWebhook) || "",
      webhook_by_events: Boolean(currentWebhook?.webhookByEvents ?? currentWebhook?.webhook_by_events ?? currentWebhook?.webhook_byevents),
    });
    console.log("[evolution-instance-events]", {
      instanceName: current.instanceName,
      enabled: Boolean(currentWebhook?.enabled),
      events: normalizeEventList(currentWebhook?.events),
      required_events: requiredWebhookEvents,
      missing_required_events: missingRequiredEvents(currentWebhook?.events),
      has_required_events: hasAllRequiredEvents(currentWebhook?.events),
      webhook_by_events: Boolean(currentWebhook?.webhookByEvents ?? currentWebhook?.webhook_by_events ?? currentWebhook?.webhook_byevents),
      webhook_record_id: webhookRecordIdFrom(currentWebhook) || "",
    });

    if (normalizeBaseUrl(currentUrl) === normalizeBaseUrl(desiredUrl) && Boolean(currentWebhook?.enabled) && hasAllRequiredEvents(currentWebhook?.events)) {
      console.log("[evolution-webhook-sync:success]", {
        instanceName: current.instanceName,
        webhook_url: currentUrl,
        updated: false,
      });
      return { skipped: false, updated: false, matched: true };
    }

    const updateResult = await updateWebhookByRecordId({
      current,
      webhookRecord: currentWebhook,
      desiredUrl,
    });

    const refreshedWebhook = await readWebhookRecord(current);
    const refreshedUrl = String(refreshedWebhook?.url || "").trim();
    console.log("[evolution-instance-events]", {
      instanceName: current.instanceName,
      enabled: Boolean(refreshedWebhook?.enabled),
      events: normalizeEventList(refreshedWebhook?.events),
      required_events: requiredWebhookEvents,
      missing_required_events: missingRequiredEvents(refreshedWebhook?.events),
      has_required_events: hasAllRequiredEvents(refreshedWebhook?.events),
      webhook_by_events: Boolean(refreshedWebhook?.webhookByEvents ?? refreshedWebhook?.webhook_by_events ?? refreshedWebhook?.webhookByevents),
      webhook_record_id: webhookRecordIdFrom(refreshedWebhook) || "",
    });
    console.log("[evolution-webhook-sync:success]", {
      instanceName: current.instanceName,
      webhook_url: refreshedUrl || desiredUrl,
      updated: true,
      webhook_record_id: updateResult.webhookId || webhookRecordIdFrom(refreshedWebhook) || "",
    });
    console.log("[evolution-webhook-sync:webhook-updated]", {
      instanceName: current.instanceName,
      webhook_url: refreshedUrl || desiredUrl,
      webhook_record_id: updateResult.webhookId || webhookRecordIdFrom(refreshedWebhook) || "",
    });
    if (normalizeBaseUrl(refreshedUrl) !== normalizeBaseUrl(desiredUrl)) {
      throw new Error(`Webhook update did not persist expected URL. expected=${desiredUrl} actual=${refreshedUrl || "missing"}`);
    }
    return { skipped: false, updated: true, webhookUrl: refreshedUrl, webhookRecordId: updateResult.webhookId || "" };
  } catch (error) {
    console.error("[evolution-webhook-sync:error]", {
      instanceName: current.instanceName || "",
      webhook_url: current.webhookUrl || "",
      message: error?.message || String(error),
      status: error?.status || "",
      data: error?.data || null,
    });
    logFullError("[evolution-webhook-sync:error-details]", error);
    throw error;
  }
};
