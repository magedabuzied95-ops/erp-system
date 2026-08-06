import type { CRMIntelligenceInput } from "./conversationTypes";

interface LeadScoreInput { messageCount: number; meaningfulMessages: number; buyingSignals: string[]; ordersCount: number; crm?: CRMIntelligenceInput; }

export function analyzeLeadScore(input: LeadScoreInput): number {
  const quality = input.messageCount ? Math.min(20, Math.round((input.meaningfulMessages / input.messageCount) * 20)) : 0;
  const depth = Math.min(20, input.messageCount * 3);
  const intent = Math.min(25, input.buyingSignals.length * 5);
  const history = Math.min(15, input.ordersCount * 5);
  const customer = Math.min(10, Number(input.crm?.score?.score || 0) * 0.1);
  const purchase = Math.min(10, Number(input.crm?.purchase?.probability || 0) * 0.1);
  return Math.max(0, Math.min(100, Math.round(quality + depth + intent + history + customer + purchase)));
}

