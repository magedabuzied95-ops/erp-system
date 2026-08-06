import type { AutomationDecision, BusinessRules, DecisionInput, DecisionValue, RiskDecision, Strategy } from "../decisionTypes";

export const AutomationStrategy: Strategy<DecisionValue<AutomationDecision>> & { evaluateWithRisk(input: DecisionInput, rules: BusinessRules, risk: RiskDecision): DecisionValue<AutomationDecision> } = {
  evaluate(input, rules) { return this.evaluateWithRisk(input, rules, { level: "Low", flags: [] }); },
  evaluateWithRisk(input, rules, risk) {
    const blockedIntent = input.conversationIntelligence.intent.find((intent) => rules.automation.blockedIntents.includes(intent));
    const blockedRisk = rules.automation.blockedRiskLevels.includes(risk.level);
    const enoughConfidence = input.conversationIntelligence.confidence >= rules.automation.minimumConfidence;
    const canAutomate = !blockedIntent && !blockedRisk && enoughConfidence;
    const reason = blockedRisk ? `${risk.level} risk requires human review.` : blockedIntent ? `${blockedIntent} is excluded from automation.` : !enoughConfidence ? "Intelligence confidence is below the automation threshold." : "Risk, intent, and confidence rules permit automation.";
    return { value: { canAutomate, automationReason: reason, suggestedFlow: canAutomate ? input.conversationIntelligence.nextBestAction.title : "Human review" }, reason, confidence: input.conversationIntelligence.confidence, source: "Business Rules" };
  },
};

