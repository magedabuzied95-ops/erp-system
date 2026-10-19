/*
 * The answer to a bare greeting, the same on every channel. "السلام عليكم" used to get only
 * "وعليكم السلام ورحمة الله، أهلاً بيك يا فندم." — polite, and a dead end: the customer had to
 * think of the next move. It now welcomes them and offers the next step (a section or a model)
 * without pushing any product at someone who has not asked for one yet.
 */

export const GREETING_NEXT_STEP = "تحب أساعدك تلاقي إيه النهارده؟ بتدور على حاجة رجالي ولا حريمي ولا أطفال، ولا في موديل معين في بالك؟";

const text = (value = "") => String(value ?? "").trim();

const SALAM = /(?:^|\s)(?:ال)?سلام(?:و)?\s*(?:عليكم|عليكو)|السلاام عليكم/;

// Openings that already end on an offer to help need no second question after them.
const asksAlready = (opening = "") => /أساعدك|اساعدك|نساعدك|محتاج إيه|محتاج ايه|[؟?]\s*$/.test(text(opening));

export const withGreetingNextStep = (opening = "") => {
  const value = text(opening);
  if (!value) return GREETING_NEXT_STEP;
  return asksAlready(value) ? value : `${value}\n${GREETING_NEXT_STEP}`;
};

const THANKS = /(?:شكر|متشكر|تسلم|ميرسي|thank|thx)/i;

// "شكراً" is classified as a greeting too; it gets a thank-you answer, not a welcome.
export const greetingReplyFor = (message = "") => {
  const value = text(message);
  if (THANKS.test(value) && !SALAM.test(value)) return "العفو يا فندم، ده واجبنا 🌷\nلو محتاج أي حاجة تانية أنا موجود.";
  if (SALAM.test(value)) return withGreetingNextStep("وعليكم السلام ورحمة الله، أهلاً بيك يا فندم ونورتنا 🌷");
  if (/صباح/.test(value)) return withGreetingNextStep("صباح النور يا فندم، نورتنا 🌷");
  if (/مساء/.test(value)) return withGreetingNextStep("مساء النور يا فندم، نورتنا 🌷");
  return withGreetingNextStep("أهلاً بيك يا فندم، نورتنا 🌷");
};

export default greetingReplyFor;
