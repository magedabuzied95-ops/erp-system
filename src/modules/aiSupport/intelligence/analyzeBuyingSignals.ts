import { BUYING_SIGNAL_PATTERNS } from "./conversationRules";

export function analyzeBuyingSignals(text: string): string[] {
  return BUYING_SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

