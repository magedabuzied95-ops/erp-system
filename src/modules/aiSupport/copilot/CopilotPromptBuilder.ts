import type { CopilotContext } from "./CopilotContext";
import type { CopilotAnalysis, CopilotPrompt } from "./CopilotTypes";

export function buildCopilotPrompt(context: CopilotContext, copilot: CopilotAnalysis): CopilotPrompt {
  return {
    system: "You are an enterprise CRM copilot. Use only the supplied analysis. Do not execute actions or invent customer facts.",
    context: {
      conversationId: context.conversation.id,
      channel: context.conversation.channel || "Unknown",
      customer: context.permissions.canViewCustomerData ? { id: context.customer.id, name: context.customer.name, status: context.customer.status } : { id: context.customer.id },
      crm: context.analysis.crm,
      conversationIntelligence: context.analysis.conversation,
      businessDecision: context.analysis.decision,
      copilot,
    },
    instructions: ["Keep responses concise and business-focused.", "Treat recommended actions as proposals only.", "Preserve recommendation reasons, confidence, and source attribution.", "Do not reveal fields excluded by permissions."],
    outputSchema: {
      title: "string",
      tone: "string",
      intent: "string",
      variables: "record<string, string | number>",
    },
  };
}

export function serializeCopilotPrompt(prompt: CopilotPrompt): string {
  return JSON.stringify(prompt);
}

