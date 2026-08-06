import type { BusinessRules, DecisionInput, DecisionValue, RiskDecision, Strategy, WorkflowType } from "../decisionTypes";

export const WorkflowStrategy: Strategy<DecisionValue<WorkflowType>> & { evaluateWithRisk(input: DecisionInput, rules: BusinessRules, risk: RiskDecision): DecisionValue<WorkflowType> } = {
  evaluate(input, rules) { return this.evaluateWithRisk(input, rules, { level: "Low", flags: [] }); },
  evaluateWithRisk(input, _rules, risk) {
    const intents = input.conversationIntelligence.intent;
    if (["High", "Critical"].includes(risk.level) || intents.includes("Complaint")) return { value: "Human Takeover", reason: "Risk or complaint handling requires a human owner.", confidence: 96, source: "CRM + Conversation" };
    if (input.conversationIntelligence.buyingSignals.includes("Asked invoice")) return { value: "Generate Invoice", reason: "The customer requested an invoice.", confidence: 95, source: "Conversation" };
    if (intents.includes("Purchase Ready")) return { value: "Create Order", reason: "Purchase readiness is confirmed.", confidence: 92, source: "Conversation" };
    if (input.conversationIntelligence.salesStage === "Lost") return { value: "Close Conversation", reason: "The customer is classified as lost.", confidence: 82, source: "CRM" };
    if (input.currentConversation.waitingMinutes) return { value: "Continue Chat", reason: "The customer is actively waiting.", confidence: 88, source: "Conversation" };
    return { value: "Schedule Follow-up", reason: "No immediate workflow transition is required.", confidence: 78, source: "CRM + Conversation" };
  },
};

