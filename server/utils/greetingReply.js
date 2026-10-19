/*
 * The answer to a bare greeting, the same on every channel, in the owner's words (2026-10-19):
 * short, and in two messages — the greeting back, then "تحت أمر حضرتك؟". No "نورتنا", no list of
 * sections: the customer says what they want next. Thanks get "تحت أمر حضرتك ❤️".
 *
 * greetingReplyParts() is what the senders that can post several messages use (reply_parts);
 * greetingReplyFor() is the same parts on two lines, for anything that sends one text.
 */

export const GREETING_OFFER = "تحت أمر حضرتك؟";

const text = (value = "") => String(value ?? "").trim();

const SALAM = /(?:^|\s)(?:ال)?سلام(?:و)?\s*(?:عليكم|عليكو)|السلاام عليكم/;
const THANKS = /(?:شكر|متشكر|تسلم|ميرسي|thank|thx)/i;
const CHECK_IN = /(?:عامل ايه|عامل إيه|ازيك|إزيك|اخبارك|أخبارك)/;

export const greetingReplyParts = (message = "") => {
  const value = text(message);
  if (THANKS.test(value) && !SALAM.test(value)) return ["تحت أمر حضرتك ❤️"];
  if (SALAM.test(value)) return ["وعليكم السلام ورحمة الله", GREETING_OFFER];
  if (/صباح/.test(value)) return ["صباح النور", GREETING_OFFER];
  if (/مساء/.test(value)) return ["مساء النور", GREETING_OFFER];
  if (CHECK_IN.test(value)) return ["الحمد لله يا فندم", GREETING_OFFER];
  return ["أهلاً بيك يا فندم", GREETING_OFFER];
};

export const greetingReplyFor = (message = "") => greetingReplyParts(message).join("\n");

export default greetingReplyFor;
