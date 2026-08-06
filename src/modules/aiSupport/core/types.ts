import type { CRMIntelligence } from "../utils/crm/crmIntelligence";
import type { ConversationIntelligence, ConversationMessage, ConversationCustomer, ConversationOrder, ConversationProduct, CurrentAgent } from "../intelligence/conversationTypes";
import type { BusinessDecision, BusinessRules, DecisionCampaign, InventorySnapshot } from "../decision/decisionTypes";

export interface AIConversation { id: string | number; messages: ConversationMessage[]; updatedAt?: string; lastMessageTimestamp?: string; channel?: string; waitingMinutes?: number; }
export interface AICustomer extends ConversationCustomer { updatedAt?: string; customer_profile?: Record<string, unknown>; metrics?: Record<string, unknown>; products?: Record<string, unknown>; insights?: Record<string, unknown>; }
export interface AIInput { conversation: AIConversation; customer: AICustomer; orders: ConversationOrder[]; inventory: InventorySnapshot; products: ConversationProduct[]; campaigns: DecisionCampaign[]; businessRules?: Partial<BusinessRules>; currentAgent?: CurrentAgent; }
export interface AIProcessingStep { engine: string; version: string; status: "completed" | "failed" | "skipped"; executionTime: number; }
export interface AIEngineError { engine: string; message: string; }
export interface AIAnalysis { crm: CRMIntelligence | null; conversation: ConversationIntelligence | null; decision: BusinessDecision | null; executionTime: number; version: string; confidence: number; engineVersions: Readonly<Record<string, string>>; processingSteps: readonly AIProcessingStep[]; errors: readonly AIEngineError[]; }
export interface AICache { get(key: string): AIAnalysis | undefined | Promise<AIAnalysis | undefined>; set(key: string, value: AIAnalysis): void | Promise<void>; }
export interface AIEngineResults { crm?: CRMIntelligence; conversation?: ConversationIntelligence; decision?: BusinessDecision; [engineName: string]: unknown; }

