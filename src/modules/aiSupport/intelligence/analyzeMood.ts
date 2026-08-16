import type { CustomerMood } from "./conversationTypes";

/**
 * Word boundaries that work in both scripts.
 *
 * Every rule below used to be written as /\b(angry|...|غاضب|...)\b/i. JavaScript's \b
 * is defined over ASCII word characters, so between an Arabic letter and a space the
 * transition it needs does not exist: the English alternatives matched and the Arabic
 * ones never did. In a store whose customers write Arabic, that meant mood analysis
 * effectively returned "Neutral" for almost everyone, while looking like it worked
 * whenever anyone tested it in English.
 */
const boundary = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");

const ANGRY = boundary("angry|unacceptable|terrible|furious|غاضب|سيء جدا|مش مقبول|نصاب|نصابين|زبالة|زباله|مش راضي|مستاء");
const URGENT = boundary("urgent|asap|immediately|now|ضروري|حالا|حالاً|بسرعة|بسرعه|النهاردة|النهارده");
const EXCITED = boundary("excited|can't wait|amazing|love it|متحمس|تحفة|تحفه|عجبني جدا|جامد");
const CONFUSED = boundary("confused|don't understand|which one|مش فاهم|محتار|مش عارف");
const PRICE_SENSITIVE = boundary("expensive|discount|cheaper|budget|غالي|غالية|خصم|أرخص|ارخص");
const HAPPY = boundary("thanks|thank you|great|perfect|شكرا|شكراً|ممتاز|تمام|تسلم");

export function analyzeMood(text: string): CustomerMood {
  if (ANGRY.test(text)) return "Angry";
  if (URGENT.test(text)) return "Urgent";
  if (EXCITED.test(text)) return "Excited";
  if (CONFUSED.test(text)) return "Confused";
  if (PRICE_SENSITIVE.test(text)) return "Price Sensitive";
  if (HAPPY.test(text)) return "Happy";
  return "Neutral";
}
