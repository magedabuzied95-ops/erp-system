import { INTENT_PATTERNS } from "./conversationRules";

export function analyzeIntent(text: string): string[] {
  const intents = INTENT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  return [...new Set(intents.length ? intents : ["Support"] )];
}

