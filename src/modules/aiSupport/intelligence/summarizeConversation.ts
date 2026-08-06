import { CONVERSATION_RULES } from "./conversationRules";
import type { ActionRecommendation, Priority } from "./conversationTypes";

interface SummaryInput { intents: string[]; buyingSignals: string[]; objections: string[]; priority: Priority; action: ActionRecommendation; }

export function summarizeConversation(input: SummaryInput): string[] {
  const bullets = [
    input.intents.length && `Intent: ${input.intents.join(", ")}.`,
    input.buyingSignals.length && `Buying signals: ${input.buyingSignals.join(", ")}.`,
    input.objections.length && `Risks or objections: ${input.objections.join(", ")}.`,
    ["Critical", "High"].includes(input.priority) && `Conversation priority is ${input.priority.toLowerCase()}.`,
    `Recommended action: ${input.action.title}.`,
  ].filter(Boolean) as string[];
  return [...new Set(bullets)].slice(0, CONVERSATION_RULES.MAX_SUMMARY_BULLETS);
}

