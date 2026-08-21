import { CONVERSATION_RULES, normalizeConversation } from "./conversationRules";
import type { ConversationAnalysisInput, ConversationIntelligence, FollowUpRecommendation } from "./conversationTypes";
import { analyzeIntent } from "./analyzeIntent";
import { analyzeMood } from "./analyzeMood";
import { analyzeLeadScore } from "./analyzeLeadScore";
import { analyzeBuyingSignals } from "./analyzeBuyingSignals";
import { analyzeObjections } from "./analyzeObjections";
import { analyzePriority } from "./analyzePriority";
import { analyzeSalesStage } from "./analyzeSalesStage";
import { recommendProducts } from "./recommendProducts";
import { recommendReply } from "./recommendReply";
import { recommendAction } from "./recommendAction";
import { recommendAssignment } from "./recommendAssignment";
import { summarizeConversation } from "./summarizeConversation";

const completedStatuses = new Set(["completed", "delivered", "paid", "success"]);

function recommendFollowUp(priority: ConversationIntelligence["priority"], channel: string): FollowUpRecommendation {
  if (priority === "Critical") return { recommendedAfter: "15 minutes", reason: "Critical conversations require immediate ownership.", channel };
  if (priority === "High") return { recommendedAfter: "2 hours", reason: "Strong urgency or purchase intent is present.", channel };
  if (priority === "Medium") return { recommendedAfter: "24 hours", reason: "The conversation has active but non-urgent signals.", channel };
  return { recommendedAfter: "3 days", reason: "A light re-engagement cadence is appropriate.", channel };
}

function buildLabels(data: { leadScore: number; intents: string[]; completedOrders: number; crmHealth?: string; priority: string; orders: ConversationAnalysisInput["orders"] }): string[] {
  const labels = [
    data.crmHealth === "VIP" && "VIP",
    data.leadScore >= CONVERSATION_RULES.HOT_LEAD_SCORE && "Hot Lead",
    data.completedOrders > 1 && "Returning",
    data.intents.includes("Complaint") && "Complaint",
    data.orders?.some((order) => ["pending", "unpaid", "invoice_open"].includes(String(order.status || "").toLowerCase())) && "Pending Payment",
    data.priority === "Critical" && "Urgent",
  ].filter(Boolean) as string[];
  return [...new Set(labels)];
}

export function analyzeConversation(input: ConversationAnalysisInput): ConversationIntelligence {
  const conversation = input.conversation || [];
  const orders = input.orders || [];
  const products = input.products || [];
  const text = normalizeConversation(conversation);
  const intents = analyzeIntent(text);
  const buyingSignals = analyzeBuyingSignals(text);
  const objections = analyzeObjections(text);
  const mood = analyzeMood(text);
  // Same defence as normalizeConversation: a null row in the merged history
  // must not decide whether this conversation gets analysed at all.
  const meaningfulMessages = conversation.filter((message) =>
    message && typeof message === "object" &&
    String(message.text || message.message || message.content || "").trim().length >= 8).length;
  const completedOrders = orders.filter((order) => completedStatuses.has(String(order.status || "").toLowerCase())).length;
  const leadScore = analyzeLeadScore({ messageCount: conversation.length, meaningfulMessages, buyingSignals, ordersCount: orders.length, crm: input.crmIntelligence });
  const { priority, urgency } = analyzePriority(leadScore, mood, intents);
  const salesStage = analyzeSalesStage({ intents, buyingSignals, objections, completedOrders, totalOrders: orders.length, lostCustomer: input.crmIntelligence?.health?.label === "Lost" });
  const purchasedIds = new Set(orders.flatMap((order) => order.items || []).map((item) => String(item.product_id || "")).filter(Boolean));
  const recommendedProducts = recommendProducts({ products, text: text.toLowerCase(), purchasedIds, crm: input.crmIntelligence });
  const nextBestReply = recommendReply(intents, mood, objections);
  const nextBestAction = recommendAction(intents, buyingSignals, objections, mood);
  const autoAssignment = recommendAssignment(intents, input.currentAgent);
  const autoLabels = buildLabels({ leadScore, intents, completedOrders, crmHealth: input.crmIntelligence?.health?.label, priority, orders });
  const followUpRecommendation = recommendFollowUp(priority, input.currentChannel || conversation.at(-1)?.channel || "Current channel");
  const confidenceSignals = intents.length + buyingSignals.length + objections.length + meaningfulMessages + orders.length;
  const confidence = Math.max(CONVERSATION_RULES.MIN_CONFIDENCE, Math.min(100, Math.round(confidenceSignals / Math.max(1, conversation.length + orders.length + 6) * 100)));
  const summary = summarizeConversation({ intents, buyingSignals, objections, priority, action: nextBestAction });
  return { intent: intents, salesStage, leadScore, customerMood: mood, urgency, buyingSignals, objections, recommendedProducts, nextBestReply, nextBestAction, priority, autoLabels, autoAssignment, followUpRecommendation, confidence, summary };
}

export type { ConversationAnalysisInput, ConversationIntelligence } from "./conversationTypes";

