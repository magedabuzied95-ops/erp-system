import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeatureFlags } from "./FeatureFlagProvider";
import { reportAIError } from "./aiTelemetry";

const analysisCache = new Map();
const MAX_CACHE_ENTRIES = 100;
const tone = (status = "") => status === "vip" || status === "preferred" ? "border-[#BBF7D0] bg-[#ECFDF5] text-[#059669]" : status === "blocked" ? "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]" : status === "human_takeover" || status === "manual" ? "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]" : "border-slate-200 bg-slate-100 text-slate-600";
const emitAnalytics = (event, detail = {}) => typeof window !== "undefined" && window.dispatchEvent(new CustomEvent("m1:ai-analytics", { detail: { event, ...detail } }));
const text = (value) => String(value || "").trim();
const list = (value) => Array.isArray(value) ? value : [];
const readCache = (key) => {
  const value = analysisCache.get(key);
  if (value) { analysisCache.delete(key); analysisCache.set(key, value); }
  return value;
};
const writeCache = (key, value) => {
  analysisCache.set(key, value);
  while (analysisCache.size > MAX_CACHE_ENTRIES) analysisCache.delete(analysisCache.keys().next().value);
};

let orchestratorPromise;
let learningPromise;
const getOrchestrator = () => {
  if (!orchestratorPromise) orchestratorPromise = Promise.all([import("../core/AIOrchestrator"), import("../core/EngineRegistry"), import("../utils/crm/crmIntelligence"), import("../intelligence/ConversationIntelligence"), import("../decision/DecisionEngine")]).then(([orchestratorModule, registryModule, crmModule, conversationModule, decisionModule]) => {
    const engines = [
      { name: "crm", version: "1.0.0", execute: ({ input }) => crmModule.buildCrmIntelligence(input.customer, { ...input.customer, orders: input.orders }, tone) },
      { name: "conversation", version: "1.0.0", dependencies: ["crm"], execute: ({ input, results }) => conversationModule.analyzeConversation({ conversation: input.conversation.messages, customer: input.customer, orders: input.orders, products: input.products, crmIntelligence: results.crm, currentAgent: input.currentAgent, currentChannel: input.conversation.channel }) },
      { name: "decision", version: "1.0.0", dependencies: ["crm", "conversation"], execute: ({ input, results }) => decisionModule.makeDecision({ conversationIntelligence: results.conversation, crmIntelligence: results.crm, inventory: input.inventory, customer: input.customer, orders: input.orders, campaigns: input.campaigns, currentConversation: { id: input.conversation.id, waitingMinutes: input.conversation.waitingMinutes, channel: input.conversation.channel }, businessRules: input.businessRules }) },
    ];
    return new orchestratorModule.AIOrchestrator(new registryModule.EngineRegistry(engines));
  });
  return orchestratorPromise;
};
const getLearning = () => {
  if (!learningPromise) learningPromise = import("../learning/LearningEngine").then(({ LearningEngine }) => new LearningEngine());
  return learningPromise;
};

const normalizeInput = (conversation, products, currentAgent) => {
  const messages = list(conversation?.messages).map((message) => ({ ...message, text: text(message.text || message.message || message.content || message.customer_message || message.message_text || message.last_message), created_at: message.created_at || message.timestamp || message.sent_at }));
  const orders = list(conversation?.customer_profile?.previous_orders || conversation?.orders || conversation?.previous_orders).map((order) => ({ ...order, createdAt: order.createdAt || order.created_at || order.order_date, items: list(order.items || order.products || order.order_items).map((item) => ({ ...item, productId: item.productId || item.product_id || item.id })) }));
  const catalog = list(products).map((product) => ({ ...product, productId: product.productId || product.product_id || product.id, available_stock: product.available_stock ?? product.stock ?? product.quantity }));
  const customer = { ...(conversation?.customer_profile || {}), ...conversation, id: conversation?.customer_profile_id || conversation?.customer_profile?.id || conversation?.external_customer_id || conversation?.id, updatedAt: conversation?.customer_profile?.updated_at || conversation?.customer_updated_at || conversation?.updated_at, orders, products: { viewed: list(conversation?.customer_profile?.viewed_products), purchased: list(conversation?.customer_profile?.purchased_products), wishlist: list(conversation?.customer_profile?.wishlist_products) }, metrics: conversation?.customer_profile?.metrics || conversation?.metrics || {} };
  const lastCustomerMessage = [...messages].reverse().find((message) => ["customer", "user", "inbound"].includes(text(message.role || message.sender_type || message.direction).toLowerCase()) || message.is_customer === true);
  return { conversation: { id: conversation?.session_id || conversation?.conversation_key || conversation?.conversation_id, messages, updatedAt: conversation?.updated_at, lastMessageTimestamp: lastCustomerMessage?.created_at || messages.at(-1)?.created_at || conversation?.last_activity_at || conversation?.updated_at, channel: conversation?.channel || conversation?.source, waitingMinutes: conversation?.waiting_minutes }, customer, orders, inventory: { products: catalog }, products: catalog, campaigns: list(conversation?.campaigns), currentAgent, businessRules: conversation?.business_rules };
};

const stateKey = (input) => `${input.conversation.id}:${input.conversation.lastMessageTimestamp || ""}:${input.customer.updatedAt || ""}:${input.orders.map((order) => JSON.stringify([order.id, order.status, order.updated_at || order.createdAt || "", order.total || order.total_amount || order.amount || 0, order.items])).join("|")}`;

export function useAIInboxAnalysis(conversation, products = [], currentAgent) {
  const { AI_ENABLED, COPILOT_ENABLED, DECISION_ENABLED, LEARNING_ENABLED } = useFeatureFlags();
  const productsRef = useRef(products);
  productsRef.current = products;
  const input = useMemo(() => conversation ? normalizeInput(conversation, productsRef.current, currentAgent) : null, [conversation, currentAgent]);
  const key = useMemo(() => input ? stateKey(input) : "", [input]);
  const [state, setState] = useState({ key: "", analysis: null, copilot: null, loading: false, error: null, cacheHit: false });

  useEffect(() => {
    if (!AI_ENABLED || !input || !key) { setState({ key, analysis: null, copilot: null, loading: false, error: null, cacheHit: false }); return undefined; }
    let active = true;
    const controller = new AbortController();
    const cached = readCache(key);
    const promise = cached || getOrchestrator().then((orchestrator) => orchestrator.analyze(input));
    if (!cached) writeCache(key, promise);
    setState((current) => current.key === key && current.analysis ? current : { key, analysis: null, copilot: null, loading: true, error: null, cacheHit: Boolean(cached) });
    void promise.then(async (analysis) => {
      if (!active || controller.signal.aborted) return;
      const copilotModule = COPILOT_ENABLED ? await import("../copilot/CopilotEngine") : null;
      if (!active || controller.signal.aborted) return;
      const copilot = copilotModule ? copilotModule.analyzeConversation({ analysis: DECISION_ENABLED ? analysis : { ...analysis, decision: null }, conversation: input.conversation, customer: input.customer, currentAgent: input.currentAgent, permissions: { allowedActions: ["Continue Chat", "Human Takeover", "Create Order", "Generate Invoice", "Schedule Follow-up", "Escalate", "Apply Coupon", "Apply Shipping Offer"], canViewCustomerData: true, canViewPricing: true } }) : null;
      setState({ key, analysis, copilot, loading: false, error: null, cacheHit: Boolean(cached) });
      emitAnalytics("AI Loaded", { conversationId: input.conversation.id, cacheHit: Boolean(cached), executionTime: analysis.executionTime });
    }).catch((error) => { analysisCache.delete(key); if (active && !controller.signal.aborted) { reportAIError("analysis", error); setState({ key, analysis: null, copilot: null, loading: false, error: new Error("AI analysis unavailable"), cacheHit: false }); } });
    return () => { active = false; controller.abort(); };
  }, [AI_ENABLED, COPILOT_ENABLED, DECISION_ENABLED, input, key]);

  const track = useCallback((recommendation, eventType = "Suggestion Viewed", details = {}) => {
    if (!LEARNING_ENABLED || !recommendation || !input) return;
    const id = recommendation.id || `${input.conversation.id}:${recommendation.title || recommendation.action || eventType}`;
    const identity = { recommendationId: id, recommendationType: recommendation.intent ? "Quick Reply" : recommendation.action ? "Suggested Action" : recommendation.category === "Warning" ? "Warning" : "Suggestion", userId: String(currentAgent?.id || "unknown"), conversationId: String(input.conversation.id), customerId: String(input.customer.id || "unknown") };
    const eventMap = { "Suggestion Accepted": "Accepted", "Suggestion Rejected": "Rejected", "Quick Reply Used": "Executed", "Manual Override": "Manual Override", "Recommendation Executed": "Executed", "Conversation Closed": "Ignored" };
    void getLearning().then((learning) => {
      try { learning.track({ ...identity, source: "AI Inbox Copilot", confidence: Number(recommendation.confidence || state.copilot?.confidence || 0), metadata: recommendation }); } catch { /* append-only duplicate view */ }
      if (eventMap[eventType]) learning.feedback(identity, eventMap[eventType], details);
    }).catch((error) => reportAIError("learning", error));
    emitAnalytics(eventType, { recommendationId: id, conversationId: input.conversation.id });
  }, [LEARNING_ENABLED, currentAgent?.id, input, state.copilot?.confidence]);

  return { ...state, track, flags: { AI_ENABLED, COPILOT_ENABLED, LEARNING_ENABLED, DECISION_ENABLED } };
}
