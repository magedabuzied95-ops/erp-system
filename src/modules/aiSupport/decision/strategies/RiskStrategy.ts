import type { BusinessRules, DecisionInput, RiskDecision, Strategy } from "../decisionTypes";

export const RiskStrategy: Strategy<RiskDecision> = {
  evaluate(input, rules) {
    const flags: string[] = [];
    if (input.customer.fraudFlag) flags.push("Fraud");
    if (input.conversationIntelligence.intent.includes("Spam")) flags.push("Spam");
    if (Number(input.customer.complaintCount || 0) >= rules.risk.repeatedComplaints) flags.push("Repeated Complaint");
    if (input.customer.abusive) flags.push("Abusive Customer");
    const level = flags.includes("Fraud") || flags.includes("Abusive Customer") ? "Critical" : flags.length >= 2 ? "High" : flags.length ? "Medium" : "Low";
    return { level, flags };
  },
};

