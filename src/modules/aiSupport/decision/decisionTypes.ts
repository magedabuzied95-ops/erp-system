import type { ConversationIntelligence } from "../intelligence/conversationTypes";
import type { CRMIntelligence } from "../utils/crm/crmIntelligence";

export type DecisionPriority = "Low" | "Medium" | "High" | "Critical";
export type DecisionSource = "Conversation" | "CRM" | "Inventory" | "Orders" | "Customer" | "Campaigns" | "Business Rules" | "CRM + Conversation" | "Inventory + Orders";
export interface DecisionReason { decision: string; reason: string; confidence: number; source: DecisionSource; }
export interface DecisionValue<T> { value: T; reason: string; confidence: number; source: DecisionSource; }
export interface DecisionProduct { id: string; name: string; score: number; price: number; category: string; reason: string; confidence: number; source: DecisionSource; }
export interface InventoryItem { productId: string | number; name?: string; category?: string; brand?: string; price?: number; stock?: number; relatedProductIds?: Array<string | number>; tier?: number; }
export interface InventorySnapshot { products: InventoryItem[]; lowStockThreshold?: number; }
export interface DecisionCustomer { id?: string | number; status?: string; lifetimeSpend?: number; returnCount?: number; complaintCount?: number; abusive?: boolean; fraudFlag?: boolean; }
export interface DecisionOrder { id?: string | number; status?: string; total?: number; createdAt?: string; items?: Array<{ productId: string | number; category?: string; price?: number }>; }
export interface DecisionCampaign { id: string | number; active: boolean; type: "Coupon" | "Discount" | "Bundle" | "Gift" | "Shipping" | "VIP"; value?: number; couponCode?: string; expiresAt?: string; eligibleCustomerIds?: Array<string | number>; }
export interface CurrentConversation { id?: string | number; waitingMinutes?: number; channel?: string; messageCount?: number; assigned?: boolean; }
export interface BusinessRules { offer: { returningDiscount: number; vipDiscount: number; maxDiscount: number; bundleMinimumItems: number; giftMinimumSpend: number; freeShippingMinimumSpend: number; }; coupon: { enabled: boolean; defaultAmount: number; expirationDays: number; minimumLeadScore: number; }; shipping: { expressUrgency: DecisionPriority[]; freeShippingMinimumSpend: number; pickupStockMinimum: number; }; risk: { repeatedComplaints: number; repeatedReturns: number; largeOrderAmount: number; waitingMinutes: number; lowStockThreshold: number; }; automation: { minimumConfidence: number; blockedIntents: string[]; blockedRiskLevels: RiskLevel[]; }; }
export interface DecisionInput { conversationIntelligence: ConversationIntelligence; crmIntelligence: CRMIntelligence; inventory: InventorySnapshot; customer: DecisionCustomer; orders: DecisionOrder[]; campaigns: DecisionCampaign[]; currentConversation: CurrentConversation; businessRules?: Partial<BusinessRules>; }
export type OfferType = "No offer" | "Discount" | "Bundle" | "Gift" | "Free shipping" | "VIP offer";
export type ShippingType = "Normal" | "Express" | "Free Shipping" | "Store Pickup";
export type WorkflowType = "Continue Chat" | "Human Takeover" | "Create Order" | "Generate Invoice" | "Schedule Follow-up" | "Wait" | "Close Conversation";
export type EscalationTarget = "None" | "Sales" | "Support" | "Accounting" | "Warehouse" | "Manager";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export interface OfferDecision { type: OfferType; value: number; }
export interface CouponDecision { code: string | null; amount: number; expiresAt: string | null; }
export interface EscalationDecision { target: EscalationTarget; priority: DecisionPriority; }
export interface AutomationDecision { canAutomate: boolean; automationReason: string; suggestedFlow: string; }
export interface RiskDecision { level: RiskLevel; flags: string[]; }
export interface BusinessDecision { priority: DecisionPriority; recommendedOffer: DecisionValue<OfferDecision>; recommendedDiscount: DecisionValue<number>; recommendedProducts: DecisionProduct[]; crossSell: DecisionProduct[]; upsell: DecisionProduct[]; coupon: DecisionValue<CouponDecision>; shippingOffer: DecisionValue<ShippingType>; nextWorkflow: DecisionValue<WorkflowType>; escalation: DecisionValue<EscalationDecision>; automation: DecisionValue<AutomationDecision>; followUp: DecisionValue<{ recommendedAfter: string; channel: string }>; warnings: Array<DecisionValue<string>>; reasoning: DecisionReason[]; confidence: number; }
export interface Strategy<T> { evaluate(input: DecisionInput, rules: BusinessRules): T; }

