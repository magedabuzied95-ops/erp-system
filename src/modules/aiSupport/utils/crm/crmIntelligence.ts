import { CRM_RULES } from "../../constants/crmRules";

type CRMRecord = Record<string, any>;
type ToneResolver = (status: string) => string;

export interface CustomerHealth { label: string; badge: string; color: string }
export interface PurchaseProbability { probability: number; confidence: string; reasons: string[] }
export interface CustomerScore { score: number; grade: "A+" | "A" | "B" | "C" | "D" }
export interface CustomerPreferences {
  favoriteBrand: string; favoriteCategory: string; favoriteColor: string;
  favoriteSize: string; budgetRange: string; replyStyle: string;
  preferredChannel?: string; preferredPurchaseTime?: string; favoritePaymentMethod?: string;
}
export interface RecommendedAction { title: string; priority: "High" | "Medium" | "Low"; icon: string; reason: string }
export interface CRMIntelligence {
  health: CustomerHealth; purchase: PurchaseProbability; score: CustomerScore;
  summary: string[]; preferences: CustomerPreferences; nextAction: RecommendedAction;
  metrics: { totalOrders: number; lifetimeSpend: number; averageOrder: number; successfulOrders: number; lastOrderDate: number; lastConversationDate: number };
}

interface OrderAnalysis {
  successfulOrders: number; orderSpend: number; lastOrderDate: number;
  openOrder: boolean; openInvoice: boolean; counts: Record<string, Record<string, number>>;
}
interface ConversationAnalysis {
  lastConversationDate: number; customerMessages: number; averageResponseMinutes: number;
  conversationText: string; counts: Record<string, number>;
}

const clean = (value: unknown = "") => String(value ?? "").trim();
const list = <T>(value: T[] | unknown): T[] => Array.isArray(value) ? value : [];
const addCount = (target: Record<string, number>, value: unknown) => {
  const key = clean(value);
  if (key) target[key] = (target[key] || 0) + 1;
};
const topValue = (values: Record<string, number>, fallback = "Not enough data") =>
  Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;

export function analyzeOrders(orders: CRMRecord[]): OrderAnalysis {
  const counts = { brand: {}, category: {}, color: {}, size: {}, payment: {}, purchaseHour: {} } as Record<string, Record<string, number>>;
  const result: OrderAnalysis = { successfulOrders: 0, orderSpend: 0, lastOrderDate: 0, openOrder: false, openInvoice: false, counts };
  orders.forEach((order) => {
    const status = clean(order.status).toLowerCase();
    const amount = Number(order.amount || order.total_amount || order.total || 0);
    const date = new Date(order.created_at || order.order_date || order.updated_at || 0).getTime();
    result.orderSpend += Number.isFinite(amount) ? amount : 0;
    if (["completed", "delivered", "paid", "success"].includes(status)) result.successfulOrders += 1;
    if (["open", "processing", "confirmed"].includes(status)) result.openOrder = true;
    if (["pending", "unpaid", "draft", "invoice_open"].includes(status)) result.openInvoice = true;
    if (Number.isFinite(date)) { result.lastOrderDate = Math.max(result.lastOrderDate, date); addCount(counts.purchaseHour, new Date(date).getHours()); }
    addCount(counts.payment, order.payment_method || order.paymentMethod);
    list<CRMRecord>(order.items || order.products || order.order_items).forEach((item) => {
      addCount(counts.brand, item.brand || item.brand_name); addCount(counts.category, item.category || item.category_name);
      addCount(counts.color, item.color || item.variant_color); addCount(counts.size, item.size || item.variant_size);
    });
  });
  return result;
}

export function analyzeConversations(messages: CRMRecord[]): ConversationAnalysis {
  let lastConversationDate = 0, customerMessages = 0, responseTotal = 0, responseSamples = 0, previousAt = 0;
  let previousWasAgent = false;
  const parts: string[] = [], counts: Record<string, number> = {};
  messages.forEach((message) => {
    const text = clean(message.text || message.message || message.content);
    const date = new Date(message.created_at || message.sent_at || message.timestamp || 0).getTime();
    const role = clean(message.role || message.sender_type || message.direction).toLowerCase();
    const isCustomer = ["customer", "user", "inbound"].includes(role);
    addCount(counts, message.channel || message.platform || message.source);
    if (text) parts.push(text.toLowerCase());
    if (Number.isFinite(date)) lastConversationDate = Math.max(lastConversationDate, date);
    if (isCustomer) { customerMessages += 1; if (previousWasAgent && previousAt && date > previousAt) { responseTotal += (date - previousAt) / 60000; responseSamples += 1; } }
    previousAt = date; previousWasAgent = !isCustomer;
  });
  return { lastConversationDate, customerMessages, averageResponseMinutes: responseSamples ? Math.round(responseTotal / responseSamples) : 0, conversationText: parts.join(" "), counts };
}

export function calculateHealth(data: CRMRecord, tone: ToneResolver): CustomerHealth {
  const { lifetimeSpend, successfulOrders, inactiveDays, totalOrders, customerAgeDays, fallbackHealth } = data;
  if (lifetimeSpend >= data.vipThreshold && successfulOrders >= CRM_RULES.VIP_ORDERS) return { label: "VIP", badge: "VIP", color: tone("vip") };
  if (inactiveDays >= CRM_RULES.LOST_DAYS) return { label: "Lost", badge: "Lost", color: tone("blocked") };
  if (successfulOrders > 1 && inactiveDays >= CRM_RULES.AT_RISK_DAYS) return { label: "At Risk", badge: "At Risk", color: tone("human_takeover") };
  if (totalOrders === 0 && inactiveDays >= CRM_RULES.DORMANT_DAYS) return { label: "Dormant", badge: "Dormant", color: tone("manual") };
  if (successfulOrders > 1) return { label: "Returning", badge: "Returning", color: tone("preferred") };
  if (totalOrders <= 1 && customerAgeDays <= CRM_RULES.NEW_CUSTOMER_DAYS) return { label: "New", badge: "New", color: tone("new") };
  return { label: fallbackHealth || "Returning", badge: fallbackHealth || "Returning", color: tone("preferred") };
}

export function calculatePurchaseProbability(data: CRMRecord): PurchaseProbability {
  const signals: Array<[boolean, number, string]> = [
    [data.recentConversation, 22, "Recent customer conversation"], [data.viewedCount > 0, 14, `Viewed ${data.viewedCount} product${data.viewedCount === 1 ? "" : "s"}`],
    [data.wishlistCount > 0, 16, `Saved ${data.wishlistCount} wishlist item${data.wishlistCount === 1 ? "" : "s"}`], [data.openOrder, 14, "Has an active order"],
    [data.openInvoice, 18, "Has an open invoice"], [data.recentPurchase, 10, "Purchased recently"], [data.repeatCustomer, 6, "Repeat customer"],
  ];
  const earned = signals.reduce((sum, [active, weight]) => sum + (active ? weight : 0), 0);
  const maximum = signals.reduce((sum, [, weight]) => sum + weight, 0);
  const active = signals.filter(([enabled]) => enabled);
  const fallback = Number(data.fallbackProbability);
  const probability = active.length ? Math.max(0, Math.min(100, Math.round((earned / maximum) * 100))) : Number.isFinite(fallback) ? Math.max(0, Math.min(100, fallback)) : 0;
  const computed = active.length >= 5 ? "High" : active.length >= 3 ? "Medium" : "Low";
  return { probability, confidence: active.length ? computed : clean(data.fallbackConfidence || computed), reasons: active.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([, , reason]) => reason) };
}

export function calculateCustomerScore(data: CRMRecord): CustomerScore {
  const score = Math.round(Math.max(0, Math.min(100, Math.min(1, data.lifetimeSpend / data.vipThreshold) * 20 + Math.min(1, data.successfulOrders / CRM_RULES.VIP_ORDERS) * 20 + data.probability * 0.25 + data.activityScore * 0.15 + (1 - Math.min(1, data.returnRate)) * 10 + (data.fastResponse ? 5 : 0) + (data.repeatCustomer ? 5 : 0))));
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";
  return { score, grade };
}

export function calculatePreferences(data: CRMRecord): CustomerPreferences {
  const hour = Number(topValue(data.order.counts.purchaseHour, "-1"));
  let replyStyle = clean(data.fallbackReplyStyle || "Researcher");
  if (data.healthLabel === "VIP") replyStyle = "VIP";
  else if (!data.customerMessages) replyStyle = "Silent Customer";
  else if (data.returnRate >= CRM_RULES.HIGH_RETURN_RATE || /problem|issue|return|refund/.test(data.text)) replyStyle = "Support Heavy";
  else if (/discount|deal|best price|offer/.test(data.text)) replyStyle = "Negotiator";
  else if (/price|cost|cheap|budget/.test(data.text)) replyStyle = "Price Sensitive";
  else if (data.fastResponse && data.recentPurchase) replyStyle = "Fast Buyer";
  else if (data.viewedCount >= 3 || /compare|details|material|specification/.test(data.text)) replyStyle = "Researcher";
  const result: CustomerPreferences = { favoriteBrand: topValue(data.order.counts.brand, data.brandFallback), favoriteCategory: topValue(data.order.counts.category, data.categoryFallback), favoriteColor: topValue(data.order.counts.color, data.colorFallback), favoriteSize: topValue(data.order.counts.size, data.sizeFallback), budgetRange: data.averageOrder ? `${Math.round(data.averageOrder * 0.75)}–${Math.round(data.averageOrder * 1.25)} EGP` : data.budgetFallback, replyStyle };
  const channel = topValue(data.conversation.counts, ""), payment = topValue(data.order.counts.payment, "");
  if (channel) result.preferredChannel = channel;
  if (hour >= 0) result.preferredPurchaseTime = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  if (payment) result.favoritePaymentMethod = payment;
  return result;
}

export function generateNextAction(data: CRMRecord): RecommendedAction {
  if (data.openInvoice) return { title: "Follow up on open invoice", priority: "High", icon: "invoice", reason: "Payment is still pending." };
  if (data.openOrder) return { title: "Review active order", priority: "High", icon: "order", reason: "The customer has an order in progress." };
  if (data.wishlistCount) return { title: "Follow up on saved products", priority: "Medium", icon: "wishlist", reason: `${data.wishlistCount} saved item${data.wishlistCount === 1 ? "" : "s"} indicate purchase intent.` };
  if (data.viewedCount) return { title: "Recommend related products", priority: "Medium", icon: "products", reason: "Recent product views indicate active interest." };
  return { title: "Re-engage customer", priority: "Low", icon: "message", reason: "No active commercial signal is available." };
}

export function generateSummary(data: CRMRecord): string[] {
  const candidates = [data.openInvoice && "An invoice is open and awaiting payment.", data.openOrder && "An active order requires monitoring.", data.purchaseIntent && `Purchase intent detected from ${data.intentSource}.`, data.totalOrders > 0 && `${data.successfulOrders} successful purchase${data.successfulOrders === 1 ? "" : "s"}, averaging ${Math.round(data.averageOrder)} EGP${data.favoriteBrand !== "Not enough data" ? `, favoring ${data.favoriteBrand}` : ""}.`, ["At Risk", "Dormant", "Lost"].includes(data.healthLabel) && `Customer is ${data.healthLabel.toLowerCase()} after ${data.inactiveDays} inactive days.`, `Recommended action: ${data.nextActionTitle}.`].filter(Boolean) as string[];
  return [...new Set(candidates)].slice(0, 5);
}

export function buildCrmIntelligence(profile: CRMRecord, context: CRMRecord, tone: ToneResolver): CRMIntelligence {
  const orders = list<CRMRecord>(profile.orders), viewed = list(profile.products?.viewed), wishlist = list(profile.products?.wishlist);
  const order = analyzeOrders(orders), conversation = analyzeConversations(list(context.conversationHistory || context.messages || context.recentMessages));
  const now = Date.now(), totalOrders = Number(profile.metrics?.totalOrders ?? orders.length), lifetimeSpend = Number(profile.metrics?.totalSpend ?? context.totalSpend ?? order.orderSpend);
  const averageOrder = Number(profile.metrics?.averageOrder ?? context.averageOrder ?? (totalOrders ? lifetimeSpend / totalOrders : 0));
  const lastActivity = Math.max(order.lastOrderDate, conversation.lastConversationDate, new Date(profile.last_active_at || 0).getTime() || 0);
  const inactiveDays = lastActivity ? Math.floor((now - lastActivity) / 86400000) : Number.POSITIVE_INFINITY;
  const customerSince = new Date(profile.customer_since || 0).getTime(), customerAgeDays = customerSince ? Math.floor((now - customerSince) / 86400000) : 0;
  const repeatCustomer = order.successfulOrders > 1, vipThreshold = Number(context.vipThreshold || CRM_RULES.VIP_SPEND), returns = Number(context.totalReturns || context.returns || 0), returnRate = totalOrders ? returns / totalOrders : 0;
  const recentConversation = conversation.lastConversationDate > now - CRM_RULES.RECENT_CONVERSATION_DAYS * 86400000, recentPurchase = order.lastOrderDate > now - CRM_RULES.RECENT_PURCHASE_DAYS * 86400000;
  const health = calculateHealth({ lifetimeSpend, successfulOrders: order.successfulOrders, inactiveDays, totalOrders, customerAgeDays, vipThreshold, fallbackHealth: context.customerHealth }, tone);
  const purchase = calculatePurchaseProbability({ recentConversation, viewedCount: viewed.length, wishlistCount: wishlist.length, openOrder: order.openOrder, openInvoice: order.openInvoice, recentPurchase, repeatCustomer, fallbackProbability: context.purchaseProbability, fallbackConfidence: context.confidence });
  const averageResponseMinutes = conversation.averageResponseMinutes || Number(context.averageResponseMinutes || 0), fastResponse = averageResponseMinutes > 0 && averageResponseMinutes <= CRM_RULES.FAST_RESPONSE_MINUTES;
  const activityScore = Math.max(0, 100 - Math.min(100, inactiveDays / CRM_RULES.LOST_DAYS * 100));
  const score = calculateCustomerScore({ lifetimeSpend, vipThreshold, successfulOrders: order.successfulOrders, probability: purchase.probability, activityScore, returnRate, fastResponse, repeatCustomer });
  const preferences = calculatePreferences({ order, conversation, healthLabel: health.label, customerMessages: conversation.customerMessages, returnRate, text: conversation.conversationText, fastResponse, recentPurchase, viewedCount: viewed.length, averageOrder, brandFallback: clean(context.favoriteBrands || context.preferredBrands || "Not enough data"), categoryFallback: clean(context.preferredCategories || context.favoriteCategory || profile.insights?.favoriteCategory || "Not enough data"), colorFallback: clean(context.preferredColors || "Not enough data"), sizeFallback: clean(context.preferredSizes || "Not enough data"), budgetFallback: clean(context.budget || context.typicalBudget || "Not enough data"), fallbackReplyStyle: context.replyStyle });
  const nextAction = generateNextAction({ openInvoice: order.openInvoice, openOrder: order.openOrder, wishlistCount: wishlist.length, viewedCount: viewed.length });
  const purchaseIntent = Boolean(wishlist.length || viewed.length || /size|price|stock|available/.test(conversation.conversationText));
  const intentSource = wishlist.length ? "saved items" : viewed.length ? "recent product views" : "the conversation";
  const summary = generateSummary({ openInvoice: order.openInvoice, openOrder: order.openOrder, purchaseIntent, intentSource, totalOrders, successfulOrders: order.successfulOrders, averageOrder, favoriteBrand: preferences.favoriteBrand, healthLabel: health.label, inactiveDays, nextActionTitle: nextAction.title });
  return { health, purchase, score, summary, preferences, nextAction, metrics: { totalOrders, lifetimeSpend, averageOrder, successfulOrders: order.successfulOrders, lastOrderDate: order.lastOrderDate, lastConversationDate: conversation.lastConversationDate } };
}
