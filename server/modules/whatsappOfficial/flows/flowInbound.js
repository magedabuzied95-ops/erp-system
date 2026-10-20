// Chatbot flow runtime — called by interceptWaOfficialInbound for every inbound message on an
// official (Cloud API) number, after the message is stored and before the AI sees it.
//
//   active session  → match the reply (button/list/template-quick-reply id, then the title text,
//                     then "1/2/3"), follow that output's edge and send the next node(s): message
//                     nodes chain on their own until an interactive node (which waits) or the end.
//                     Free text that matches nothing re-sends the waiting node once; the second
//                     time the session ends and the AI takes the message.
//   no session      → start the number's flow when its trigger matches and the session TTL allows.
//
// Returns { handled: true } whenever the flow sent something. Never throws; never waits on Graph
// for more than a few seconds (the first send is awaited briefly, the rest go on in the background).
import db from "../../../database/db.js";
import { ensureChatbotFlowSchema } from "./flowSchema.js";
import {
  edgeFrom,
  findOutputOwner,
  findStartNode,
  isWaitingNode,
  matchOutput,
  nodeById,
  normalizeGraph,
  normalizeReply,
} from "./flowGraph.js";
import { recordTranscript, sendFlowNode } from "./flowSender.js";

const str = (value) => String(value ?? "").trim();
const arr = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
const FIRST_SEND_WAIT_MS = 4000;
const MAX_CHAIN = 20;
const SKIPPED_TYPES = new Set(["reaction", "system", "unsupported", "order", "ephemeral", "request_welcome"]);

export const digitsOf = (value) => {
  let digits = str(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Egyptian local form 01xxxxxxxxx → 201xxxxxxxxx (Cloud API wants the international number).
  if (/^01\d{9}$/.test(digits)) digits = `2${digits}`;
  return digits;
};

/* ------------------------------------------------------------------ number settings */

const settingsCache = new Map();
let settingsTableKnown = null;

// The per-number settings belong to the accounts work (table wa_account_settings). Read
// defensively: the table, the row or any column may not exist yet.
export const loadAccountSettings = async (tenantId, phoneNumberId) => {
  const key = `${tenantId}:${phoneNumberId}`;
  const cached = settingsCache.get(key);
  if (cached && cached.at > Date.now() - 15000) return cached.value;
  let value = null;
  try {
    if (settingsTableKnown !== true) {
      const check = await db.query(`SELECT to_regclass('public.wa_account_settings') IS NOT NULL AS ok`);
      settingsTableKnown = check.rows[0]?.ok === true ? true : null;
    }
    if (settingsTableKnown) {
      let result;
      try {
        result = await db.query(
          `SELECT to_jsonb(s) AS row FROM wa_account_settings s WHERE s.tenant_id = $1 AND s.phone_number_id = $2::text LIMIT 1`,
          [Number(tenantId) || 0, str(phoneNumberId)]
        );
      } catch {
        result = await db.query(
          `SELECT to_jsonb(s) AS row FROM wa_account_settings s WHERE s.phone_number_id = $1::text LIMIT 1`,
          [str(phoneNumberId)]
        );
      }
      value = result.rows[0]?.row || null;
    }
  } catch (error) {
    console.warn("[wa-flows] account settings unreadable", { message: String(error?.message || error).slice(0, 160) });
    value = null;
  }
  settingsCache.set(key, { at: Date.now(), value });
  return value;
};

const boolSetting = (value) => {
  if (value === true || value === false) return value;
  const text = str(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return null;
};

/** session_ttl → { once } | { ms } | { always } */
export const parseSessionTtl = (value) => {
  const text = str(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!text || ["run_once", "once", "never", "never_repeat"].includes(text)) return { once: true };
  if (["always", "none", "0", "every_time", "no_limit"].includes(text)) return { always: true };
  const match = text.match(/^(\d+)_?(m|min|mins|minutes?|h|hr|hours?|d|days?)$/);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2][0];
    const ms = unit === "m" ? amount * 60000 : unit === "h" ? amount * 3600000 : amount * 86400000;
    return ms > 0 ? { ms } : { always: true };
  }
  if (/^\d+$/.test(text)) return { ms: Number(text) * 3600000 };
  return { once: true };
};

/* ------------------------------------------------------------------ triggers */

export const triggerMatches = (trigger, textValue) => {
  const config = obj(trigger);
  const type = str(config.type) || "any_message";
  if (type === "keywords") {
    const typed = normalizeReply(textValue);
    if (!typed) return false;
    const padded = ` ${typed} `;
    // Arabic: "السعر" / "بالسعر" should match the keyword "سعر".
    const bare = (token) => token.replace(/^(و|ب|ف|ك)?ال(?=..)/, "");
    const tokens = typed.split(" ").map(bare);
    return arr(config.keywords).some((keyword) => {
      const word = normalizeReply(keyword);
      if (!word) return false;
      if (typed === word || padded.includes(` ${word} `) || (word.length >= 4 && typed.includes(word))) return true;
      return !word.includes(" ") && tokens.includes(bare(word));
    });
  }
  return true;
};

const isFirstMessage = async (tenantId, conversationKey) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*)::int AS n FROM ai_support_messages
        WHERE tenant_id = $1 AND session_id = $2::text AND sender_type = 'customer'
          AND created_at > NOW() - INTERVAL '24 hours' AND created_at < NOW() - INTERVAL '20 seconds'`,
      [Number(tenantId) || 0, conversationKey]
    );
    return Number(result.rows[0]?.n || 0) === 0;
  } catch {
    return false;
  }
};

const ttlAllows = async (tenantId, flowId, conversationKey, ttl) => {
  if (ttl.always) return true;
  const result = await db.query(
    `SELECT started_at FROM wa_chatbot_sessions
      WHERE tenant_id = $1 AND flow_id = $2 AND conversation_key = $3::text AND is_test = FALSE
      ORDER BY started_at DESC LIMIT 1`,
    [tenantId, flowId, conversationKey]
  );
  const last = result.rows[0]?.started_at;
  if (!last) return true;
  if (ttl.once) return false;
  return Date.now() - new Date(last).getTime() >= ttl.ms;
};

const recentlyInCampaign = async (tenantId, phone) => {
  try {
    const check = await db.query(`SELECT to_regclass('public.marketing_broadcast_recipients') IS NOT NULL AS ok`);
    if (!check.rows[0]?.ok) return false;
    const tail = digitsOf(phone).slice(-10);
    if (!tail) return false;
    const result = await db.query(
      `SELECT 1 FROM marketing_broadcast_recipients
        WHERE tenant_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'
          AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) = $2::text
        LIMIT 1`,
      [Number(tenantId) || 0, tail]
    );
    return Boolean(result.rows[0]);
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ flows + sessions */

const candidateFlows = async (tenantId, phoneNumberId, settings) => {
  const enabled = boolSetting(settings?.chatbot_flow_enabled);
  if (settings && enabled === false) return [];
  const chosenId = Number(settings?.chatbot_flow_id) || 0;
  if (settings && enabled === true && chosenId) {
    const result = await db.query(
      `SELECT * FROM wa_chatbot_flows WHERE tenant_id = $1 AND id = $2 AND status = 'active' AND published_graph IS NOT NULL`,
      [tenantId, chosenId]
    );
    return result.rows;
  }
  const result = await db.query(
    `SELECT * FROM wa_chatbot_flows
      WHERE tenant_id = $1 AND status = 'active' AND published_graph IS NOT NULL
        AND (jsonb_array_length(phone_number_ids) = 0 OR phone_number_ids ? $2::text)
      ORDER BY (jsonb_array_length(phone_number_ids) > 0) DESC, updated_at DESC
      LIMIT 20`,
    [tenantId, str(phoneNumberId)]
  );
  return result.rows;
};

const loadActiveSession = async (tenantId, phoneNumberId, conversationKey) => {
  const result = await db.query(
    `SELECT * FROM wa_chatbot_sessions
      WHERE tenant_id = $1 AND conversation_key = $2::text AND phone_number_id = $3::text AND status = 'active'
      ORDER BY last_at DESC LIMIT 1`,
    [tenantId, conversationKey, str(phoneNumberId)]
  );
  return result.rows[0] || null;
};

const endSession = (sessionId, status = "ended", reason = "") =>
  db.query(
    `UPDATE wa_chatbot_sessions SET status = $2::text, end_reason = $3::text, ended_at = NOW(), last_at = NOW() WHERE id = $1`,
    [sessionId, status, str(reason).slice(0, 40)]
  ).catch(() => null);

const endOtherSessions = (tenantId, conversationKey, reason) =>
  db.query(
    `UPDATE wa_chatbot_sessions SET status = 'ended', end_reason = $3::text, ended_at = NOW()
      WHERE tenant_id = $1 AND conversation_key = $2::text AND status = 'active'`,
    [tenantId, conversationKey, reason]
  ).catch(() => null);

const createSession = async ({ tenantId, flowId, phoneNumberId, conversationKey, phone, vars, isTest = false }) => {
  const result = await db.query(
    `INSERT INTO wa_chatbot_sessions (tenant_id, flow_id, phone_number_id, conversation_key, customer_phone, vars, is_test, run_count)
     VALUES ($1, $2, $3::text, $4::text, $5::text, $6::jsonb, $7, 0)
     RETURNING *`,
    [tenantId, flowId, str(phoneNumberId), conversationKey, str(phone).slice(0, 40), JSON.stringify(vars || {}), isTest === true]
  );
  return result.rows[0];
};

const saveSession = (sessionId, { currentNodeId, vars, ended, reason }) =>
  db.query(
    `UPDATE wa_chatbot_sessions
        SET current_node_id = $2::text, vars = $3::jsonb, run_count = run_count + 1, last_at = NOW(),
            status = CASE WHEN $4::boolean THEN 'ended' ELSE status END,
            end_reason = CASE WHEN $4::boolean THEN $5::text ELSE end_reason END,
            ended_at = CASE WHEN $4::boolean THEN NOW() ELSE ended_at END
      WHERE id = $1`,
    [sessionId, str(currentNodeId), JSON.stringify(vars || {}), ended === true, str(reason).slice(0, 40)]
  );

/* ------------------------------------------------------------------ team notification */

// "Notify team": the conversation is handed to humans (same path as the AI's own escalation) and
// an in-app notification points the team at it.
const notifyTeam = async ({ tenantId, conversationKey, flowName, nodeLabel, customerName }) => {
  try {
    const { markAiSupportConversationEscalated } = await import("../../../services/aiSupportLogService.js");
    await markAiSupportConversationEscalated({
      tenantId,
      sessionId: conversationKey,
      reason: "CHATBOT_FLOW_NOTIFY_TEAM",
      keyword: str(nodeLabel).slice(0, 80),
      source: "wa_chatbot_flow",
    }).catch(() => null);
    const { createNotification } = await import("../../../services/notificationsService.js");
    await createNotification({
      tenant_id: tenantId,
      type: "wa_chatbot_flow_notify",
      category: "inbox",
      priority: "high",
      title: `WhatsApp: ${str(customerName) || conversationKey.replace(/^whatsapp:/, "")}`,
      message: `${str(flowName)}${nodeLabel ? ` → ${str(nodeLabel)}` : ""}`,
      action_url: `/admin/ai-inbox?conversation=${encodeURIComponent(conversationKey)}`,
      entity_type: "ai_support_session",
      entity_id: conversationKey,
      metadata: { source: "wa_chatbot_flow" },
    }).catch(() => null);
    const { emitToRooms } = await import("../../../utils/socket.js");
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationKey, at: new Date().toISOString() });
  } catch (error) {
    console.warn("[wa-flows] notify team failed", { message: String(error?.message || error).slice(0, 160) });
  }
};

/* ------------------------------------------------------------------ walking */

/** From `nodeId`, collect the nodes to send until a waiting node or the end. */
export const walkFrom = (graph, nodeId) => {
  const toSend = [];
  let waiting = null;
  let currentId = nodeId;
  const seen = new Set();
  for (let step = 0; step < MAX_CHAIN; step += 1) {
    const node = nodeById(graph, currentId);
    if (!node || seen.has(node.id)) break;
    seen.add(node.id);
    toSend.push(node);
    if (isWaitingNode(node)) {
      waiting = node;
      break;
    }
    if (node.data?.end_session === true) break;
    const edge = edgeFrom(graph, node.id, "next");
    if (!edge) break;
    currentId = edge.target;
  }
  return { toSend, waiting };
};

const delay = (ms) => new Promise((resolve) => { setTimeout(() => resolve({ ok: true, pending: true }), ms); });

/**
 * Sends the nodes in order. Awaits the first one up to FIRST_SEND_WAIT_MS (or every one, with
 * waitAll for the test route), then continues in the background. Returns the first outcome.
 */
const sendChain = async ({ ctx, nodes, sessionId, waitAll = false }) => {
  const sendOne = async (node) => {
    const outcome = await sendFlowNode({ tenantId: ctx.tenantId, phoneNumberId: ctx.phoneNumberId, phone: ctx.phone, node, vars: ctx.vars });
    if (outcome.ok) {
      void recordTranscript({
        tenantId: ctx.tenantId,
        conversationKey: ctx.conversationKey,
        phone: ctx.phone,
        phoneNumberId: ctx.phoneNumberId,
        node,
        vars: ctx.vars,
        messageId: outcome.message_id,
        flowName: ctx.flowName,
        // What actually left (header, footer, buttons, filled template body), read off the payload.
        transcript: outcome.transcript,
      });
      if (node.data?.notify_team === true) {
        void notifyTeam({ tenantId: ctx.tenantId, conversationKey: ctx.conversationKey, flowName: ctx.flowName, nodeLabel: node.data?.label || node.type, customerName: ctx.vars?.name });
      }
    }
    return outcome;
  };

  const rest = async (firstPromise) => {
    const first = await firstPromise;
    if (!first.ok) {
      await endSession(sessionId, "ended", "send_failed");
      return [first];
    }
    const outcomes = [first];
    for (const node of nodes.slice(1)) {
      const outcome = await sendOne(node);
      outcomes.push(outcome);
      if (!outcome.ok) {
        await endSession(sessionId, "ended", "send_failed");
        break;
      }
    }
    return outcomes;
  };

  if (!nodes.length) return { ok: false, outcomes: [] };
  const firstPromise = sendOne(nodes[0]);
  if (waitAll) {
    const outcomes = await rest(firstPromise);
    return { ok: outcomes.every((item) => item.ok), outcomes };
  }
  void rest(firstPromise).catch(() => null);
  const first = await Promise.race([firstPromise, delay(FIRST_SEND_WAIT_MS)]);
  return { ok: first.ok, outcomes: [first] };
};

const runFrom = async ({ ctx, graph, session, nodeId, reason = "" }) => {
  const { toSend, waiting } = walkFrom(graph, nodeId);
  if (!toSend.length) {
    await endSession(session.id, "ended", reason || "no_next_node");
    return { handled: false, reason: "no_next_node" };
  }
  const vars = { ...ctx.vars, _retries: 0 };
  await saveSession(session.id, {
    currentNodeId: waiting ? waiting.id : toSend[toSend.length - 1].id,
    vars,
    ended: !waiting,
    reason: waiting ? "" : "completed",
  });
  const sent = await sendChain({ ctx: { ...ctx, vars }, nodes: toSend, sessionId: session.id, waitAll: ctx.waitAll });
  if (!sent.ok) {
    await endSession(session.id, "ended", "send_failed");
    return { handled: false, reason: "send_failed", error: sent.outcomes?.[0]?.error || "" };
  }
  return { handled: true, reason: reason || "flow_step", sent: toSend.length, waiting: waiting?.id || "" };
};

const graphOf = (flow, isTest) => normalizeGraph(isTest ? flow.graph : flow.published_graph);

/* ------------------------------------------------------------------ inbound */

const replyOf = (message = {}) => {
  const raw = obj(obj(message.raw).message);
  const replyId = str(raw.interactive?.button_reply?.id || raw.interactive?.list_reply?.id || raw.button?.payload || message.quick_reply_payload);
  return { raw, replyId, text: str(message.message_text) };
};

const varsFor = (message, phone, previous = {}) => {
  const name = str(message?.customer_name) || str(previous.name);
  return { ...obj(previous), name, first_name: name.split(/\s+/)[0] || "", phone: str(phone) };
};

const runInbound = async ({ tenantId: rawTenant, phoneNumberId, message }) => {
  const tenantId = Number(rawTenant) || 0;
  if (!tenantId || !str(phoneNumberId) || !message) return { handled: false };
  const { raw, replyId, text } = replyOf(message);
  if (SKIPPED_TYPES.has(str(raw.type))) return { handled: false, reason: "skipped_type" };
  const phone = str(message.external_customer_id) || str(raw.from);
  const conversationKey = str(message.external_conversation_id) || (phone ? `whatsapp:${phone}` : "");
  if (!conversationKey || !phone) return { handled: false };

  await ensureChatbotFlowSchema();
  const settings = await loadAccountSettings(tenantId, phoneNumberId);
  const flowsEnabled = boolSetting(settings?.chatbot_flow_enabled);

  /* ---- an active session answers first */
  let session = await loadActiveSession(tenantId, phoneNumberId, conversationKey);
  if (session && Date.now() - new Date(session.last_at).getTime() > SESSION_IDLE_MS) {
    await endSession(session.id, "expired", "idle");
    session = null;
  }
  if (session) {
    const flowResult = await db.query(`SELECT * FROM wa_chatbot_flows WHERE tenant_id = $1 AND id = $2`, [tenantId, session.flow_id]);
    const flow = flowResult.rows[0];
    const usable = flow && (session.is_test || (flow.status === "active" && flow.published_graph && flowsEnabled !== false));
    if (!usable) {
      await endSession(session.id, "ended", "flow_off");
      // fall through: the message may start a flow afresh
    } else {
      const graph = graphOf(flow, session.is_test);
      const ctx = {
        tenantId,
        phoneNumberId: str(phoneNumberId),
        phone,
        conversationKey,
        flowName: flow.name,
        vars: varsFor(message, phone, session.vars),
      };
      let node = nodeById(graph, session.current_node_id);
      if (!node) {
        await endSession(session.id, "ended", "node_missing");
        return { handled: false, reason: "node_missing" };
      }
      let output = isWaitingNode(node) ? matchOutput(node, { replyId, text }) : null;
      if (!output && replyId) {
        const owner = findOutputOwner(graph, replyId);
        if (owner) {
          node = owner.node;
          output = owner.output;
        }
      }
      if (output) {
        ctx.vars.last_reply = output.title;
        const edge = edgeFrom(graph, node.id, output.id);
        if (!edge) {
          // The node says the session ends on this choice: the AI answers the tap from here.
          await endSession(session.id, "ended", "ended_on_output");
          return { handled: false, reason: "ended_on_output" };
        }
        return runFrom({ ctx, graph, session, nodeId: edge.target, reason: "reply_matched" });
      }
      const retries = Number(session.vars?._retries || 0);
      if (retries < 1 && isWaitingNode(node)) {
        const vars = { ...ctx.vars, _retries: retries + 1 };
        await saveSession(session.id, { currentNodeId: node.id, vars, ended: false });
        const sent = await sendChain({ ctx: { ...ctx, vars }, nodes: [node], sessionId: session.id });
        if (sent.ok) return { handled: true, reason: "resent_waiting_node" };
      }
      await endSession(session.id, "ended", "unmatched_reply");
      return { handled: false, reason: "unmatched_reply" };
    }
  }

  /* ---- no session: maybe start one */
  const flows = await candidateFlows(tenantId, phoneNumberId, settings);
  if (!flows.length) return { handled: false, reason: "no_flow" };

  const vars = varsFor(message, phone, {});
  const baseCtx = { tenantId, phoneNumberId: str(phoneNumberId), phone, conversationKey, vars };

  // A tap on a button of an older flow message resumes that branch, whatever the TTL says.
  if (replyId) {
    for (const flow of flows) {
      const graph = graphOf(flow, false);
      const owner = findOutputOwner(graph, replyId);
      const edge = owner ? edgeFrom(graph, owner.node.id, owner.output.id) : null;
      if (!edge) continue;
      await endOtherSessions(tenantId, conversationKey, "replaced");
      const created = await createSession({ tenantId, flowId: flow.id, phoneNumberId, conversationKey, phone, vars });
      return runFrom({
        ctx: { ...baseCtx, flowName: flow.name, vars: { ...vars, last_reply: owner.output.title } },
        graph,
        session: created,
        nodeId: edge.target,
        reason: "stale_reply_resumed",
      });
    }
  }

  const ttl = parseSessionTtl(settings?.session_ttl);
  const campaignBlocks = boolSetting(settings?.active_during_campaign) === false;
  let firstMessage = null;
  let inCampaign = null;
  for (const flow of flows) {
    const trigger = obj(flow.trigger);
    if (str(trigger.type) === "first_message") {
      if (firstMessage === null) firstMessage = await isFirstMessage(tenantId, conversationKey);
      if (!firstMessage) continue;
    } else if (!triggerMatches(trigger, text)) {
      continue;
    }
    if (!(await ttlAllows(tenantId, flow.id, conversationKey, ttl))) continue;
    if (campaignBlocks) {
      if (inCampaign === null) inCampaign = await recentlyInCampaign(tenantId, phone);
      if (inCampaign) return { handled: false, reason: "campaign_reply" };
    }
    const graph = graphOf(flow, false);
    const start = findStartNode(graph);
    if (!start) continue;
    await endOtherSessions(tenantId, conversationKey, "replaced");
    const created = await createSession({ tenantId, flowId: flow.id, phoneNumberId, conversationKey, phone, vars });
    return runFrom({ ctx: { ...baseCtx, flowName: flow.name }, graph, session: created, nodeId: start.id, reason: "flow_started" });
  }
  return { handled: false, reason: "no_trigger_match" };
};

export const handleFlowInbound = async (input = {}) => {
  try {
    return await runInbound(input);
  } catch (error) {
    console.warn("[wa-flows] inbound handler failed", { message: String(error?.message || error).slice(0, 200) });
    return { handled: false, reason: "error" };
  }
};

/**
 * Starts one given flow for an inbound message: a template campaign's own chatbot flow answering
 * the customer's reply to it (see campaignAttribution/campaignReplyInbound.js). The campaign has
 * already decided the reply is its own, so there is no trigger or TTL check; a conversation that
 * is mid-way through another flow keeps it. A tap on one of this flow's buttons (a template quick
 * reply whose payload is a flow output id) continues that branch instead of starting over.
 */
export const startFlowForInbound = async ({ tenantId: rawTenant, phoneNumberId, message, flowId, reason = "campaign_flow" } = {}) => {
  try {
    const tenantId = Number(rawTenant) || 0;
    if (!tenantId || !str(phoneNumberId) || !message || !Number(flowId)) return { handled: false };
    const { raw, replyId } = replyOf(message);
    if (SKIPPED_TYPES.has(str(raw.type))) return { handled: false, reason: "skipped_type" };
    const phone = str(message.external_customer_id) || str(raw.from);
    const conversationKey = str(message.external_conversation_id) || (phone ? `whatsapp:${phone}` : "");
    if (!conversationKey || !phone) return { handled: false };
    await ensureChatbotFlowSchema();
    if (await loadActiveSession(tenantId, phoneNumberId, conversationKey)) return { handled: false, reason: "session_active" };
    const found = await db.query(
      `SELECT * FROM wa_chatbot_flows WHERE tenant_id = $1 AND id = $2 AND status = 'active' AND published_graph IS NOT NULL`,
      [tenantId, Number(flowId)]
    );
    const flow = found.rows[0];
    if (!flow) return { handled: false, reason: "flow_off" };
    const graph = graphOf(flow, false);
    const owner = replyId ? findOutputOwner(graph, replyId) : null;
    const edge = owner ? edgeFrom(graph, owner.node.id, owner.output.id) : null;
    const start = edge ? null : findStartNode(graph);
    if (!edge && !start) return { handled: false, reason: "empty_flow" };
    const vars = varsFor(message, phone, {});
    await endOtherSessions(tenantId, conversationKey, "replaced");
    const created = await createSession({ tenantId, flowId: flow.id, phoneNumberId, conversationKey, phone, vars });
    return await runFrom({
      ctx: { tenantId, phoneNumberId: str(phoneNumberId), phone, conversationKey, flowName: flow.name, vars: owner ? { ...vars, last_reply: owner.output.title } : vars },
      graph,
      session: created,
      nodeId: edge ? edge.target : start.id,
      reason,
    });
  } catch (error) {
    console.warn("[wa-flows] campaign flow start failed", { message: String(error?.message || error).slice(0, 200) });
    return { handled: false, reason: "error" };
  }
};

/* ------------------------------------------------------------------ test run */

/**
 * Starts a flow (its current, possibly unpublished graph) for one phone. Only inside the 24-hour
 * service window: interactive messages cannot open a conversation. Awaits every send.
 */
export const startFlowForPhone = async ({ tenantId, flow, phone: rawPhone, phoneNumberId }) => {
  await ensureChatbotFlowSchema();
  const phone = digitsOf(rawPhone);
  if (phone.length < 8) return { ok: false, status: 400, code: "invalid_phone" };
  const conversationKey = `whatsapp:${phone}`;
  const windowResult = await db.query(
    `SELECT MAX(created_at) AS last_in, MAX(NULLIF(customer_name, '')) AS name FROM ai_support_messages
      WHERE tenant_id = $1 AND session_id = $2::text AND sender_type = 'customer'`,
    [tenantId, conversationKey]
  ).catch(() => ({ rows: [] }));
  const lastIn = windowResult.rows[0]?.last_in;
  if (!lastIn || Date.now() - new Date(lastIn).getTime() > SESSION_IDLE_MS) {
    return { ok: false, status: 422, code: "outside_24h_window" };
  }
  const graph = normalizeGraph(flow.graph);
  const start = findStartNode(graph);
  if (!start) return { ok: false, status: 422, code: "empty_flow" };
  await endOtherSessions(tenantId, conversationKey, "replaced_by_test");
  const vars = varsFor({ customer_name: windowResult.rows[0]?.name || "" }, phone, {});
  const session = await createSession({ tenantId, flowId: flow.id, phoneNumberId, conversationKey, phone, vars, isTest: true });
  const result = await runFrom({
    ctx: { tenantId, phoneNumberId: str(phoneNumberId), phone, conversationKey, flowName: flow.name, vars, waitAll: true },
    graph,
    session,
    nodeId: start.id,
    reason: "test_started",
  });
  if (!result.handled) return { ok: false, status: 502, code: result.reason || "send_failed", error: result.error || "" };
  return { ok: true, session_id: session.id, sent: result.sent, waiting: result.waiting };
};

export default handleFlowInbound;
