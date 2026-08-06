import { OBJECTION_PATTERNS } from "./conversationRules";

export function analyzeObjections(text: string): string[] {
  return OBJECTION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

