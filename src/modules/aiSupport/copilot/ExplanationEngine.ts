import type { CopilotContext } from "./CopilotContext";
import type { CopilotAction, CopilotExplanation, CopilotSuggestion } from "./CopilotTypes";

export function buildExplanations(context: CopilotContext, suggestions: readonly CopilotSuggestion[], actions: readonly CopilotAction[]): CopilotExplanation[] {
  const conversationEvidence = context.analysis.conversation?.summary || [];
  const decisionEvidence = context.analysis.decision?.reasoning.map((item) => `${item.decision}: ${item.reason}`) || [];
  const evidence = [...new Set([...conversationEvidence, ...decisionEvidence])].slice(0, 5);
  const suggestionExplanations = suggestions.map((suggestion) => ({ recommendationId: suggestion.id, why: suggestion.reason, evidence, confidence: suggestion.confidence, sourceEngine: suggestion.sourceEngine }));
  const actionExplanations = actions.map((action) => ({ recommendationId: `action:${action.action}`, why: action.reason, evidence, confidence: context.analysis.decision?.confidence || context.analysis.confidence, sourceEngine: "Decision Engine" }));
  return [...suggestionExplanations, ...actionExplanations];
}

