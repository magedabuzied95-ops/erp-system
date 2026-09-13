// Vodafone Cash has no API for a merchant wallet, so the SMS it sends the owner is the
// only machine-readable record of a transfer. An iPhone Shortcut forwards that text to
// the webhook and this file turns it into fields. It stays free of imports so the tests
// can run it on real message shapes.
//
// The two shapes seen so far (2026-09-13):
//   تم استلام مبلغ 1700 جنيه من رقم 010XXXXXXXX المسجل بإسم <name> على رقم محفظتك 010XXXXXXXX.
//   رصيدك الحالي: 67839.59 جنيه / تاريخ العملية: 15:57 26-09-13 / رقم العملية: 023667172814
//
//   تم تحويل 3000 جنيه لرقم 010XXXXXXXX مصاريف الخدمة 1 جنيه رصيد حسابك فى فودافون كاش الحالي 66139.59.
//   تاريخ العملية 03:24 26-09-13 : / رقم العملية 023655832529 :
//
// The date is YY-MM-DD in Cairo time.

const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

const toLatinDigits = (value = "") =>
  String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) => String(EASTERN_DIGITS.indexOf(digit) % 10));

const MONEY = "(\\d[\\d,]*(?:\\.\\d+)?)";
const PHONE = "((?:\\+?20|0)?1\\d{9})";

const money = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
};

const localPhone = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^201\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^1\d{9}$/.test(digits)) return `0${digits}`;
  return digits;
};

const match = (text, pattern) => text.match(new RegExp(pattern, "u"));

// "15:57 26-09-13" -> "2026-09-13 15:57:00" (a Cairo wall-clock time, no zone).
const parseOccurredLocal = (text) => {
  const found = match(text, "تاريخ\\s+العملية\\s*:?\\s*(\\d{1,2}):(\\d{2})\\s+(\\d{2})-(\\d{2})-(\\d{2})");
  if (!found) return "";
  const [, hour, minute, year, month, day] = found;
  const h = Number(hour);
  const mo = Number(month);
  const d = Number(day);
  if (h > 23 || Number(minute) > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `20${year}-${month}-${day} ${String(h).padStart(2, "0")}:${minute}:00`;
};

export const parseVodafoneCashSms = (raw = "") => {
  const text = toLatinDigits(raw).replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim();
  const reference = match(text, "رقم\\s+العملية\\s*:?\\s*(\\d{6,})")?.[1] || "";
  const occurredLocal = parseOccurredLocal(text);
  const balanceAfter = money(match(text, `رصيد(?:ك|\\s+حسابك)[^\\d]{0,40}?${MONEY}`)?.[1]);

  const incoming = match(
    text,
    `تم\\s+استلام\\s+مبلغ\\s+${MONEY}\\s*جنيه\\s+من\\s+رقم\\s+${PHONE}(?:\\s+المسجل\\s+ب[إا]سم\\s+(.+?))?\\s+على\\s+رقم\\s+محفظتك\\s+${PHONE}`
  );
  if (incoming) {
    return {
      kind: "incoming",
      amount: money(incoming[1]),
      fee: null,
      counterpartyPhone: localPhone(incoming[2]),
      counterpartyName: String(incoming[3] || "").trim(),
      walletNumber: localPhone(incoming[4]),
      balanceAfter,
      occurredLocal,
      reference,
      complete: Boolean(money(incoming[1]) && reference),
    };
  }

  const outgoing = match(text, `تم\\s+تحويل\\s+${MONEY}\\s*جنيه\\s+(?:ل|إلى\\s+|الى\\s+)رقم\\s+${PHONE}`);
  if (outgoing) {
    return {
      kind: "outgoing",
      amount: money(outgoing[1]),
      fee: money(match(text, `مصاريف\\s+الخدمة\\s+${MONEY}`)?.[1]),
      counterpartyPhone: localPhone(outgoing[2]),
      counterpartyName: "",
      walletNumber: "",
      balanceAfter,
      occurredLocal,
      reference,
      complete: Boolean(money(outgoing[1]) && reference),
    };
  }

  return {
    kind: "unknown",
    amount: null,
    fee: null,
    counterpartyPhone: "",
    counterpartyName: "",
    walletNumber: "",
    balanceAfter,
    occurredLocal,
    reference,
    complete: false,
  };
};

// The Shortcut reports whatever iOS shows as the sender. A forged SMS can carry the
// same words, so only a sender that names Vodafone may confirm an order on its own —
// anything else is kept for a person to look at.
export const isTrustedVodafoneSender = (sender = "") =>
  /vf|vodafone|فودافون/i.test(String(sender || ""));
