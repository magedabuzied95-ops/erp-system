import type { AIAnalysis, AIConversation, AICustomer } from "../core/types";
import type { CurrentAgent } from "../intelligence/conversationTypes";
import type { DecisionPriority, DecisionSource } from "../decision/decisionTypes";

export interface CopilotPermissions { allowedActions: readonly string[]; canViewCustomerData?: boolean; canViewPricing?: boolean; }
export interface CopilotInput { analysis: AIAnalysis; conversation: AIConversation; customer: AICustomer; currentAgent?: CurrentAgent; permissions: CopilotPermissions; }
export interface CopilotSuggestion { id: string; title: string; category: "Offer" | "Product" | "Escalation" | "Payment" | "Workflow" | "Shipping"; priority: DecisionPriority; reason: string; confidence: number; sourceEngine: string; }
export interface CopilotAction { action: string; priority: DecisionPriority; reason: string; permitted: boolean; parameters: Readonly<Record<string, unknown>>; }
export interface CopilotExplanation { recommendationId: string; why: string; evidence: readonly string[]; confidence: number; sourceEngine: string; }
export interface CopilotQuickReply { title: string; tone: string; intent: string; variables: Readonly<Record<string, string | number>>; }
export interface CopilotWarning { title: string; reason: string; priority: DecisionPriority; confidence: number; source: DecisionSource; }
export interface CopilotAnalysis { summary: readonly string[]; suggestions: readonly CopilotSuggestion[]; recommendedActions: readonly CopilotAction[]; explanations: readonly CopilotExplanation[]; quickReplies: readonly CopilotQuickReply[]; warnings: readonly CopilotWarning[]; confidence: number; }
export interface CopilotPrompt { system: string; context: Readonly<Record<string, unknown>>; instructions: readonly string[]; outputSchema: Readonly<Record<string, unknown>>; }

