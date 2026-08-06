import type { BusinessRules, DecisionInput, DecisionValue, EscalationDecision, RiskDecision, Strategy } from "../decisionTypes";

export const EscalationStrategy: Strategy<DecisionValue<EscalationDecision>> & { evaluateWithRisk(input: DecisionInput, rules: BusinessRules, risk: RiskDecision): DecisionValue<EscalationDecision> } = {
  evaluate(input, rules) { return this.evaluateWithRisk(input, rules, { level: "Low", flags: [] }); },
  evaluateWithRisk(input, _rules, risk) {
    if (risk.level === "Critical") return { value: { target: "Manager", priority: "Critical" }, reason: `Critical risk detected: ${risk.flags.join(", ")}.`, confidence: 98, source: "CRM + Conversation" };
    const assignment = input.conversationIntelligence.autoAssignment.team;
    const target = assignment === "Manager" || assignment === "Support" || assignment === "Accounting" || assignment === "Warehouse" ? assignment : input.conversationIntelligence.priority === "High" ? "Sales" : "None";
    return { value: { target, priority: target === "None" ? "Low" : input.conversationIntelligence.priority }, reason: target === "None" ? "No escalation trigger is active." : `${assignment} expertise matches the detected need.`, confidence: target === "None" ? 84 : 90, source: "Conversation" };
  },
};

