import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reportsDir = path.resolve(__dirname, "../reports");

const BASE_URL = String(process.env.AI_INBOX_REGRESSION_BASE_URL || "https://erp-system-0qhp.onrender.com").replace(/\/+$/g, "");
const ADMIN_EMAIL = String(process.env.AI_INBOX_REGRESSION_EMAIL || "admin").trim();
const ADMIN_PASSWORD = String(process.env.AI_INBOX_REGRESSION_PASSWORD || "admin").trim();
const TENANT_ID = Number(process.env.AI_INBOX_REGRESSION_TENANT_ID || 1) || 1;
const META_APP_SECRET = String(process.env.META_APP_SECRET || "").trim();
const WHATSAPP_APP_SECRET = String(process.env.WHATSAPP_APP_SECRET || META_APP_SECRET).trim();
const AI_REGRESSION_TEST_KEY = String(process.env.AI_REGRESSION_TEST_KEY || "").trim();
const META_PAGE_ID = String(process.env.AI_INBOX_REGRESSION_META_PAGE_ID || process.env.META_PAGE_ID || "100012345678901").trim();
const INSTAGRAM_ACCOUNT_ID = String(
  process.env.AI_INBOX_REGRESSION_INSTAGRAM_ACCOUNT_ID ||
  process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
  "17841400000000000"
).trim();

const nowStamp = () => new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const safeJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
};

const report = {
  started_at: new Date().toISOString(),
  base_url: BASE_URL,
  tenant_id: TENANT_ID,
  auth: {
    email: ADMIN_EMAIL,
    login_success: false,
  },
  scenarios: [],
  failures: [],
};

const printStep = (scenarioName, label, result, extra = {}) => {
  const output = {
    scenario: scenarioName,
    step: label,
    endpoint: extra.endpoint || "",
    status: result?.status ?? null,
    ok: result?.ok ?? null,
    request: extra.request || null,
    response: result?.payload ?? result?.responseText ?? null,
  };
  console.log(`[regression] ${safeJson(output)}`);
};

const addScenario = (scenario) => {
  report.scenarios.push(scenario);
  return scenario;
};

const hmacSignature = (rawBody, secret) => {
  if (!secret) return "";
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
};

const requestJson = async (pathname, {
  method = "GET",
  body,
  token = "",
  headers = {},
  expectJson = true,
} = {}) => {
  const rawBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(rawBody ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: rawBody,
  });
  const responseText = await response.text();
  let payload = responseText;
  if (expectJson) {
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { parse_error: true, raw: responseText };
    }
  }
  return { ok: response.ok, status: response.status, payload, rawBody, responseText };
};

const normalizeProductCard = (product = {}) => {
  const imageUrl = text(
    product.image_url ||
    product.image ||
    product.main_image ||
    product.main_image_url ||
    product.thumbnail_url ||
    product.cover_image_url
  );
  const productUrl = text(
    product.product_url ||
    product.storefront_url ||
    product.url ||
    product.link
  );
  const price = Number(product.sale_price ?? product.price ?? product.product_price ?? 0) || 0;
  return {
    product_id: product.product_id || product.id || "",
    variant_id: product.variant_id || product.selected_variant_id || "",
    product_name: text(product.product_name || product.name || product.title || product.model_name),
    color: text(product.color || product.selected_color || ""),
    size: text(product.size || product.selected_size || ""),
    price,
    image_url: imageUrl,
    product_url: productUrl,
  };
};

const fallbackRegressionProductCard = () => ({
  product_id: "regression-card-air-jordan-4",
  variant_id: "regression-variant-black-42",
  product_name: "Regression Air Jordan 4",
  color: "Black",
  size: "42",
  price: 1650,
  image_url: "https://example.com/regression/air-jordan-4-black.jpg",
  product_url: "https://example.com/regression/air-jordan-4-black",
});

const findConversation = (conversations = [], conversationId = "", channel = "") =>
  asArray(conversations).find((item) => {
    const keys = [
      item.session_id,
      item.conversation_id,
      item.external_conversation_id,
      item.conversation_key,
    ].map(text);
    return keys.includes(text(conversationId)) && (!channel || text(item.channel) === text(channel));
  }) || null;

const findMessage = (messages = [], predicate) => asArray(messages).find(predicate) || null;

const summarizeMessage = (message = {}) => ({
  id: message.id || null,
  session_id: text(message.session_id || ""),
  channel: text(message.channel || ""),
  sender_type: text(message.sender_type || ""),
  message_type: text(message.message_type || ""),
  customer_message: text(message.customer_message || message.message_text || ""),
  ai_answer: text(message.ai_answer || ""),
  staff_message: text(message.staff_message || ""),
  delivery_status: text(message.delivery_status || ""),
  external_message_id: text(message.external_message_id || ""),
  provider_message_id: text(message.provider_message_id || ""),
  created_at: message.created_at || null,
  product_cards_count: asArray(message.product_cards || message.suggested_products).length,
});

const login = async () => {
  const result = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  report.auth.login_status = result.status;
  report.auth.login_response = result.payload;
  if (!result.ok || !result.payload?.token) {
    throw new Error(`Login failed with status ${result.status}`);
  }
  report.auth.login_success = true;
  return result.payload.token;
};

const loadConversations = async (token, channel = "") => {
  const query = new URLSearchParams({
    tenant_id: String(TENANT_ID),
    limit: "100",
    ...(channel ? { channel } : {}),
  });
  return requestJson(`/api/ai-inbox/conversations?${query.toString()}`, { token });
};

const loadMessages = async (token, conversationId) => {
  const encoded = encodeURIComponent(conversationId);
  return requestJson(`/api/ai-inbox/conversations/${encoded}/messages?limit=100`, { token });
};

const loadRegressionLookup = async (token, conversationId, messageText) => {
  const query = new URLSearchParams({
    tenant_id: String(TENANT_ID),
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(messageText ? { message_text: messageText } : {}),
  });
  return requestJson(`/api/ai-inbox/debug/regression-lookup?${query.toString()}`, { token });
};

const loadProducts = async () => {
  const query = new URLSearchParams({ limit: "10" });
  const result = await requestJson(`/api/products?${query.toString()}`, { expectJson: true });
  const candidates = [
    ...asArray(result.payload?.products),
    ...asArray(result.payload?.items),
    ...asArray(result.payload?.data),
  ];
  const picked = candidates.map(normalizeProductCard).find((item) =>
    item.product_id && item.product_name && item.price > 0 && item.image_url && item.product_url
  ) || candidates.map(normalizeProductCard).find((item) => item.product_id && item.product_name) || null;
  return { result, product: picked };
};

const postSignedWebhook = async (pathname, body, secret) => {
  const rawBody = JSON.stringify(body);
  return requestJson(pathname, {
    method: "POST",
    body,
    headers: {
      ...(AI_REGRESSION_TEST_KEY ? { "x-ai-regression-test-key": AI_REGRESSION_TEST_KEY } : {}),
      ...(AI_REGRESSION_TEST_KEY ? {} : secret ? { "x-hub-signature-256": hmacSignature(rawBody, secret) } : {}),
    },
  });
};

const recordLookupBundle = async (scenario, token, stage, { messageText = "", channel = "" } = {}) => {
  const lookup = await loadRegressionLookup(token, scenario.conversation_id, messageText);
  const conversations = await loadConversations(token, channel || scenario.channel || "");
  const messages = await loadMessages(token, scenario.conversation_id);
  scenario[`${stage}_lookup`] = lookup;
  scenario[`${stage}_conversations_response`] = conversations;
  scenario[`${stage}_messages_response`] = messages;
  printStep(scenario.name, `${stage}_lookup`, lookup, {
    endpoint: `/api/ai-inbox/debug/regression-lookup?tenant_id=${TENANT_ID}&conversation_id=${encodeURIComponent(scenario.conversation_id)}&message_text=${encodeURIComponent(messageText)}`,
  });
  printStep(scenario.name, `${stage}_conversations`, conversations, {
    endpoint: `/api/ai-inbox/conversations?tenant_id=${TENANT_ID}&limit=100&channel=${encodeURIComponent(channel || scenario.channel || "")}`,
  });
  printStep(scenario.name, `${stage}_messages`, messages, {
    endpoint: `/api/ai-inbox/conversations/${encodeURIComponent(scenario.conversation_id)}/messages?limit=100`,
  });
  return { lookup, conversations, messages };
};

const runWhatsappScenario = async (token, productCard) => {
  const stamp = nowStamp();
  const customerId = `201111${stamp.slice(-8)}`;
  const conversationId = `whatsapp:${customerId}`;
  const inboundText = `WA regression inbound ${stamp}`;
  const outboundText = `WA regression outbound ${stamp}`;
  const providerMessageId = `wamid.regression.${stamp}`;
  const scenario = addScenario({
    name: "whatsapp",
    channel: "whatsapp",
    conversation_id: conversationId,
    customer_id: customerId,
    inbound_text: inboundText,
    outbound_text: outboundText,
    endpoint_tested: [
      "/api/ai-agent/channels/whatsapp/webhook",
      "/api/ai-inbox/conversations",
      `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
      `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/send`,
      `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/product-card/send`,
    ],
    inbound_endpoint: "/api/ai-agent/channels/whatsapp/webhook",
    generated_ids: {
      customer_id: customerId,
      provider_message_id: providerMessageId,
    },
  });
  console.log(`[regression] ${safeJson({
    scenario: scenario.name,
    inbound_endpoint: scenario.inbound_endpoint,
    conversation_id: conversationId,
    generated_text: inboundText,
    generated_ids: scenario.generated_ids,
  })}`);

  const inboundPayload = {
    tenant_id: TENANT_ID,
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: {
            tenant_id: TENANT_ID,
            phone_number_id: "regression-phone-number-id",
            display_phone_number: "201000000000",
          },
          contacts: [{
            wa_id: customerId,
            profile: { name: `Regression WA ${stamp}` },
          }],
          messages: [{
            from: customerId,
            id: providerMessageId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body: inboundText },
          }],
        },
      }],
    }],
  };

  scenario.inbound_response = await postSignedWebhook("/api/ai-agent/channels/whatsapp/webhook", inboundPayload, WHATSAPP_APP_SECRET);
  printStep(scenario.name, "inbound_webhook", scenario.inbound_response, {
    endpoint: scenario.inbound_endpoint,
    request: inboundPayload,
  });
  await wait(2000);
  const inboundBundle = await recordLookupBundle(scenario, token, "after_inbound", { messageText: inboundText, channel: "whatsapp" });
  scenario.conversations_response = inboundBundle.conversations;
  scenario.conversation = findConversation(scenario.conversations_response.payload?.conversations, conversationId, "whatsapp");
  scenario.messages_after_inbound = inboundBundle.messages;
  scenario.inbound_message = findMessage(
    scenario.messages_after_inbound.payload?.messages,
    (item) => text(item.customer_message || item.message_text || "").includes(inboundText)
  );

  scenario.outbound_response = await requestJson(`/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/send`, {
    method: "POST",
    token,
    body: { message: outboundText, tenant_id: TENANT_ID, mock_delivery: true },
  });
  printStep(scenario.name, "outbound_send", scenario.outbound_response, {
    endpoint: `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/send`,
    request: { message: outboundText, tenant_id: TENANT_ID, mock_delivery: true },
  });
  await wait(1500);
  const outboundBundle = await recordLookupBundle(scenario, token, "after_outbound", { messageText: outboundText, channel: "whatsapp" });
  scenario.messages_after_outbound = outboundBundle.messages;
  scenario.outbound_message = findMessage(
    scenario.messages_after_outbound.payload?.messages,
    (item) => text(item.staff_message || item.ai_answer || item.message_text || "").includes(outboundText)
  );
  scenario.ai_reply_generation_response = await requestJson(`/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/ai-reply`, {
    method: "POST",
    token,
      body: { tenant_id: TENANT_ID, persist: false },
  });
  printStep(scenario.name, "ai_reply_generation", scenario.ai_reply_generation_response, {
    endpoint: `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/ai-reply`,
    request: { tenant_id: TENANT_ID, persist: false },
  });

  if (productCard) {
    scenario.product_card_send_response = await requestJson(`/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/product-card/send`, {
      method: "POST",
      token,
      body: { tenant_id: TENANT_ID, product_cards: [productCard], mock_delivery: true },
    });
    printStep(scenario.name, "product_card_send", scenario.product_card_send_response, {
      endpoint: `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/product-card/send`,
      request: { tenant_id: TENANT_ID, product_cards: [productCard], mock_delivery: true },
    });
    await wait(1500);
    const productBundle = await recordLookupBundle(scenario, token, "after_product_card", {
      messageText: text(productCard.product_name || productCard.product_id || "product"),
      channel: "whatsapp",
    });
    scenario.messages_after_product_card = productBundle.messages;
    scenario.product_card_message = findMessage(
      scenario.messages_after_product_card.payload?.messages,
      (item) => text(item.message_type) === "product_card" || asArray(item.product_cards || item.suggested_products).length > 0
    );
  }

  scenario.assertions = {
    inbound_stored: Boolean(scenario.inbound_message),
    inbox_visible: Boolean(scenario.conversation),
    session_matches: text(scenario.conversation?.session_id || scenario.conversation?.conversation_id || "") === conversationId,
    outbound_logged: Boolean(scenario.outbound_message),
    ai_reply_generated: Boolean(
      text(
        scenario.ai_reply_generation_response.payload?.draft?.text ||
        scenario.ai_reply_generation_response.payload?.ai_reply_draft?.text ||
        scenario.ai_reply_generation_response.payload?.suggestion?.text ||
        scenario.ai_reply_generation_response.payload?.message ||
        ""
      )
    ),
    outbound_delivery_status: text(
      scenario.outbound_response.payload?.delivery_status ||
      scenario.outbound_message?.delivery_status ||
      ""
    ),
    product_card_logged: Boolean(scenario.product_card_message),
    product_card_has_required_fields: Boolean(
      scenario.product_card_message &&
      asArray(scenario.product_card_message.product_cards || scenario.product_card_message.suggested_products).some((card) =>
        text(card.image_url || card.image || "") &&
        text(card.product_url || card.storefront_url || "") &&
        Number(card.price ?? 0) > 0
      )
    ),
  };
};

const buildMetaPayload = ({ channel, senderId, recipientId, messageId, textBody, stamp }) => ({
  tenant_id: TENANT_ID,
  object: channel === "instagram" ? "instagram" : "page",
  entry: [{
    id: recipientId,
    messaging: [{
      sender: { id: senderId },
      recipient: { id: recipientId },
      timestamp: Date.now(),
      message: {
        mid: messageId,
        text: textBody,
      },
    }],
  }],
  _regression_stamp: stamp,
});

const runMetaScenario = async ({ token, channel, recipientId, productCard }) => {
  const stamp = nowStamp();
  const senderId = channel === "instagram" ? `1784${stamp.slice(-10)}` : `1000${stamp.slice(-10)}`;
  const conversationId = `${channel}:${senderId}`;
  const inboundText = `${channel} regression inbound ${stamp}`;
  const outboundText = `${channel} regression outbound ${stamp}`;
  const messageId = `${channel}-mid-${stamp}`;
  const scenario = addScenario({
    name: channel,
    channel,
    conversation_id: conversationId,
    sender_id: senderId,
    recipient_id: recipientId,
    inbound_text: inboundText,
    outbound_text: outboundText,
    endpoint_tested: [
      "/api/ai-agent/channels/meta/webhook",
      "/api/ai-inbox/conversations",
      `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
      `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/send`,
      `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/product-card/send`,
    ],
    inbound_endpoint: "/api/ai-agent/channels/meta/webhook",
    generated_ids: {
      sender_id: senderId,
      recipient_id: recipientId,
      provider_message_id: messageId,
    },
  });
  console.log(`[regression] ${safeJson({
    scenario: scenario.name,
    inbound_endpoint: scenario.inbound_endpoint,
    conversation_id: conversationId,
    generated_text: inboundText,
    generated_ids: scenario.generated_ids,
  })}`);

  const inboundPayload = buildMetaPayload({
    channel,
    senderId,
    recipientId,
    messageId,
    textBody: inboundText,
    stamp,
  });
  scenario.inbound_response = await postSignedWebhook("/api/ai-agent/channels/meta/webhook", inboundPayload, META_APP_SECRET);
  printStep(scenario.name, "inbound_webhook", scenario.inbound_response, {
    endpoint: scenario.inbound_endpoint,
    request: inboundPayload,
  });
  await wait(2000);
  const inboundBundle = await recordLookupBundle(scenario, token, "after_inbound", { messageText: inboundText, channel });
  scenario.conversations_response = inboundBundle.conversations;
  scenario.conversation = findConversation(scenario.conversations_response.payload?.conversations, conversationId, channel);
  scenario.messages_after_inbound = inboundBundle.messages;
  scenario.inbound_message = findMessage(
    scenario.messages_after_inbound.payload?.messages,
    (item) => text(item.customer_message || item.message_text || "").includes(inboundText)
  );

  scenario.outbound_response = await requestJson(`/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/send`, {
    method: "POST",
    token,
    body: { message: outboundText, tenant_id: TENANT_ID, mock_delivery: true },
  });
  printStep(scenario.name, "outbound_send", scenario.outbound_response, {
    endpoint: `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/send`,
    request: { message: outboundText, tenant_id: TENANT_ID, mock_delivery: true },
  });
  await wait(1500);
  const outboundBundle = await recordLookupBundle(scenario, token, "after_outbound", { messageText: outboundText, channel });
  scenario.messages_after_outbound = outboundBundle.messages;
  scenario.outbound_message = findMessage(
    scenario.messages_after_outbound.payload?.messages,
    (item) => text(item.staff_message || item.ai_answer || item.message_text || "").includes(outboundText)
  );
  scenario.ai_reply_generation_response = await requestJson(`/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/ai-reply`, {
    method: "POST",
    token,
      body: { tenant_id: TENANT_ID, persist: false },
  });
  printStep(scenario.name, "ai_reply_generation", scenario.ai_reply_generation_response, {
    endpoint: `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/ai-reply`,
    request: { tenant_id: TENANT_ID, persist: false },
  });

  if (productCard) {
    scenario.product_card_send_response = await requestJson(`/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/product-card/send`, {
      method: "POST",
      token,
      body: { tenant_id: TENANT_ID, product_cards: [productCard], mock_delivery: true },
    });
    printStep(scenario.name, "product_card_send", scenario.product_card_send_response, {
      endpoint: `/api/ai-inbox/conversations/${encodeURIComponent(conversationId)}/product-card/send`,
      request: { tenant_id: TENANT_ID, product_cards: [productCard], mock_delivery: true },
    });
    await wait(1500);
    const productBundle = await recordLookupBundle(scenario, token, "after_product_card", {
      messageText: text(productCard.product_name || productCard.product_id || "product"),
      channel,
    });
    scenario.messages_after_product_card = productBundle.messages;
    scenario.product_card_message = findMessage(
      scenario.messages_after_product_card.payload?.messages,
      (item) => text(item.message_type) === "product_card" || asArray(item.product_cards || item.suggested_products).length > 0
    );
  }

  scenario.assertions = {
    inbound_stored: Boolean(scenario.inbound_message),
    inbox_visible: Boolean(scenario.conversation),
    session_matches: text(scenario.conversation?.session_id || scenario.conversation?.conversation_id || "") === conversationId,
    conversation_format_ok: channel === "facebook_messenger"
      ? conversationId === `facebook_messenger:${senderId}`
      : conversationId === `instagram:${senderId}`,
    outbound_logged: Boolean(scenario.outbound_message),
    ai_reply_generated: Boolean(
      text(
        scenario.ai_reply_generation_response.payload?.draft?.text ||
        scenario.ai_reply_generation_response.payload?.ai_reply_draft?.text ||
        scenario.ai_reply_generation_response.payload?.suggestion?.text ||
        scenario.ai_reply_generation_response.payload?.message ||
        ""
      )
    ),
    outbound_delivery_status: text(
      scenario.outbound_response.payload?.delivery_status ||
      scenario.outbound_message?.delivery_status ||
      ""
    ),
    product_card_logged: Boolean(scenario.product_card_message),
    product_card_has_required_fields: Boolean(
      scenario.product_card_message &&
      asArray(scenario.product_card_message.product_cards || scenario.product_card_message.suggested_products).some((card) =>
        text(card.image_url || card.image || "") &&
        text(card.product_url || card.storefront_url || "") &&
        Number(card.price ?? 0) > 0
      )
    ),
    psid_not_page_id: channel !== "facebook_messenger" || !conversationId.endsWith(`:${recipientId}`),
  };
};

const renderMarkdown = () => {
  const lines = [
    "# AI Inbox Channel Regression",
    "",
    `- Started: ${report.started_at}`,
    `- Finished: ${report.finished_at || ""}`,
    `- Base URL: ${report.base_url}`,
    `- Tenant: ${report.tenant_id}`,
    `- Login success: ${report.auth.login_success}`,
    "",
  ];
  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.name}`);
    lines.push("");
    lines.push(`- Conversation ID: ${scenario.conversation_id}`);
    lines.push(`- Inbound stored: ${Boolean(scenario.assertions?.inbound_stored)}`);
    lines.push(`- Inbox visible: ${Boolean(scenario.assertions?.inbox_visible)}`);
    lines.push(`- Session matches: ${Boolean(scenario.assertions?.session_matches)}`);
    lines.push(`- Outbound logged: ${Boolean(scenario.assertions?.outbound_logged)}`);
    lines.push(`- Outbound delivery: ${scenario.assertions?.outbound_delivery_status || ""}`);
    lines.push(`- Product card logged: ${Boolean(scenario.assertions?.product_card_logged)}`);
    lines.push("");
  }
  if (report.failures.length) {
    lines.push("## Failures", "");
    for (const failure of report.failures) {
      lines.push(`- ${failure}`);
    }
    lines.push("");
  }
  return lines.join("\n");
};

const main = async () => {
  const token = await login();
  printStep("auth", "login", { status: report.auth.login_status, ok: report.auth.login_success, payload: report.auth.login_response }, {
    endpoint: "/api/auth/login",
    request: { email: ADMIN_EMAIL, password: "***" },
  });
  const { product: loadedProduct } = await loadProducts();
  const product = loadedProduct || fallbackRegressionProductCard();
  console.log(`[regression] ${safeJson({ scenario: "products", step: "selected_product_card", product })}`);
  await runWhatsappScenario(token, product);
  await runMetaScenario({ token, channel: "facebook_messenger", recipientId: META_PAGE_ID, productCard: product });
  await runMetaScenario({ token, channel: "instagram", recipientId: INSTAGRAM_ACCOUNT_ID, productCard: product });

  for (const scenario of report.scenarios) {
    if (!scenario.assertions?.inbound_stored) report.failures.push(`${scenario.name}: inbound message not found in transcript`);
    if (!scenario.assertions?.inbox_visible) report.failures.push(`${scenario.name}: conversation not visible in AI Inbox`);
    if (!scenario.assertions?.session_matches) report.failures.push(`${scenario.name}: conversation/session id mismatch`);
    if (!scenario.assertions?.outbound_logged) report.failures.push(`${scenario.name}: outbound message not logged`);
    if (!scenario.assertions?.ai_reply_generated) report.failures.push(`${scenario.name}: AI reply generation returned no draft text`);
    if (scenario.product_card_send_response && !scenario.assertions?.product_card_logged) {
      report.failures.push(`${scenario.name}: product card message not logged`);
    }
  }

  report.finished_at = new Date().toISOString();
  await fs.mkdir(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, "ai-inbox-channel-regression-report.json");
  const mdPath = path.join(reportsDir, "ai-inbox-channel-regression-report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, `${renderMarkdown()}\n`, "utf8");
  console.log(`Report written: ${jsonPath}`);
  console.log(`Report written: ${mdPath}`);
  if (report.failures.length) {
    console.log(`Failures: ${report.failures.length}`);
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  report.finished_at = new Date().toISOString();
  report.failures.push(error?.message || String(error));
  await fs.mkdir(reportsDir, { recursive: true }).catch(() => {});
  await fs.writeFile(
    path.join(reportsDir, "ai-inbox-channel-regression-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  ).catch(() => {});
  console.error(error);
  process.exit(1);
});
