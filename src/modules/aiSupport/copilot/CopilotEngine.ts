import { CopilotContext } from "./CopilotContext";
import type { CopilotAnalysis, CopilotInput, CopilotQuickReply, CopilotWarning } from "./CopilotTypes";
import { buildSuggestions } from "./SuggestionEngine";
import { buildRecommendedActions } from "./ActionEngine";
import { buildExplanations } from "./ExplanationEngine";

export const COPILOT_VERSION = "1.0.0";

const freeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

function buildSummary(context: CopilotContext): string[] {
  const conversation = context.analysis.conversation?.summary || [];
  const decision = context.analysis.decision;
  const candidates = [...conversation, decision && `Priority: ${decision.priority}.`, decision && `Next workflow: ${decision.nextWorkflow.value}.`, decision?.warnings[0] && `Warning: ${decision.warnings[0].value}.`].filter(Boolean) as string[];
  return [...new Set(candidates)].slice(0, 5);
}

function buildQuickReplies(context: CopilotContext): CopilotQuickReply[] {
  const intelligence = context.analysis.conversation;
  if (!intelligence) return [];
  const variables: Record<string, string | number> = { customerName: context.customer.name || "Customer", channel: context.conversation.channel || "Current channel" };
  return intelligence.intent.slice(0, 3).map((intent, index) => ({ title: index === 0 ? intelligence.nextBestReply.title : `Address ${intent}`, tone: intelligence.nextBestReply.tone, intent, variables }));
}

function buildWarnings(context: CopilotContext): CopilotWarning[] {
  const decision = context.analysis.decision;
  if (!decision) return [];
  return decision.warnings.map((warning) => ({ title: warning.value, reason: warning.reason, priority: warning.value === "Customer Waiting" || warning.value === "Payment Risk" ? "High" : "Medium", confidence: warning.confidence, source: warning.source }));
}

export function analyzeConversation(input: CopilotInput): CopilotAnalysis {
  const context = new CopilotContext(input);
  const suggestions = buildSuggestions(context);
  const recommendedActions = buildRecommendedActions(context);
  const result: CopilotAnalysis = {
    summary: buildSummary(context),
    suggestions,
    recommendedActions,
    explanations: buildExplanations(context, suggestions, recommendedActions),
    quickReplies: buildQuickReplies(context),
    warnings: buildWarnings(context),
    confidence: context.analysis.confidence,
  };
  return freeze(result) as CopilotAnalysis;
}

export type { CopilotAnalysis, CopilotInput } from "./CopilotTypes";

