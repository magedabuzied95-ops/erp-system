import type { CustomerMood } from "./conversationTypes";

export function analyzeMood(text: string): CustomerMood {
  if (/\b(angry|unacceptable|terrible|furious|غاضب|سيء جدا|مش مقبول)\b/i.test(text)) return "Angry";
  if (/\b(urgent|asap|immediately|now|ضروري|حالاً|بسرعة)\b/i.test(text)) return "Urgent";
  if (/\b(excited|can't wait|amazing|love it|متحمس|تحفة|عجبني جدا)\b/i.test(text)) return "Excited";
  if (/\b(confused|don't understand|which one|مش فاهم|محتار)\b/i.test(text)) return "Confused";
  if (/\b(expensive|discount|cheaper|budget|غالي|خصم|أرخص)\b/i.test(text)) return "Price Sensitive";
  if (/\b(thanks|thank you|great|perfect|شكرا|ممتاز|تمام)\b/i.test(text)) return "Happy";
  return "Neutral";
}

