import { parseVodafoneCashSms } from "./vodafoneCashSms.js";

// One entry point for every money-received SMS the owner's phone forwards: Vodafone
// Cash, and the two banks InstaPay lands in. Free of I/O so the tests run real shapes.
//
// United Bank (2026-09-13) — no sender, no reference; the balance makes it unique:
//   عملية ايداع مبلغ 1150.00 EGP حساب رقم 001 يوم 2026-09-13 15:14:53 الرصيد 1182220.87 دائن للاستعلام 19200
//
// CIB (2026-09-11) — the sender's name arrives with its spaces gone:
//   يرجى العلم انه تم تنفيذ تحويل لحظي بمبلغ 2700.00 جم إلى حسابك المنتهي بـ ********2572
//   من محمدمجدى علىالبواب برقم مرجعي e46bbe82 بتاريخ 11-09-2026 21:59 للمزيد، برجاء الاتصال بـ 19666

export const TRANSFER_PROVIDERS = ["vodafone_cash", "cib", "united_bank"];

const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const toLatinDigits = (value = "") =>
  String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) => String(EASTERN_DIGITS.indexOf(digit) % 10));

const MONEY = "(\\d[\\d,]*(?:\\.\\d+)?)";
const money = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
};
const match = (text, pattern) => text.match(new RegExp(pattern, "u"));
const two = (value) => String(value).padStart(2, "0");

const clean = (raw) => toLatinDigits(raw).replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim();

const empty = (provider, extra = {}) => ({
  provider,
  kind: "unknown",
  amount: null,
  fee: null,
  counterpartyPhone: "",
  counterpartyName: "",
  walletNumber: "",
  balanceAfter: null,
  occurredLocal: "",
  reference: "",
  complete: false,
  ...extra,
});

export const parseUnitedBankSms = (raw = "") => {
  const text = clean(raw);
  const found = match(
    text,
    `عملية\\s+[إا]يداع\\s+مبلغ\\s+${MONEY}\\s*(?:EGP|جنيه|ج\\.?م)?\\s+حساب\\s+رقم\\s+(\\d+)\\s+يوم\\s+(\\d{4})-(\\d{2})-(\\d{2})\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?`
  );
  if (!found) return null;
  const [, amountText, account, year, month, day, hour, minute, second = "00"] = found;
  const amount = money(amountText);
  const balanceAfter = money(match(text, `الرصيد\\s*:?\\s*${MONEY}`)?.[1]);
  return {
    ...empty("united_bank"),
    kind: "incoming",
    amount,
    walletNumber: account,
    balanceAfter,
    occurredLocal: `${year}-${month}-${day} ${two(hour)}:${minute}:${second}`,
    // The bank sends no transaction number. Time + amount + the balance after it is one
    // deposit only, so the same SMS forwarded twice still collapses into one row.
    reference: amount ? `${year}${month}${day}${two(hour)}${minute}${second}-${amount}-${balanceAfter ?? ""}` : "",
    complete: Boolean(amount),
  };
};

export const parseCibSms = (raw = "") => {
  const text = clean(raw);
  const found = match(
    text,
    `تحويل\\s+لحظي\\s+بمبلغ\\s+${MONEY}\\s*(?:جم|جنيه|ج\\.?م|EGP)?\\s+[إا]لى\\s+حسابك\\s+المنتهي\\s+ب\\S*\\s*\\**\\s*(\\d{3,})\\s+من\\s+(.+?)\\s+برقم\\s+مرجعي\\s+([A-Za-z0-9]+)\\s+بتاريخ\\s+(\\d{2})-(\\d{2})-(\\d{4})\\s+(\\d{1,2}):(\\d{2})`
  );
  if (!found) return null;
  const [, amountText, account, name, reference, day, month, year, hour, minute] = found;
  const amount = money(amountText);
  return {
    ...empty("cib"),
    kind: "incoming",
    amount,
    counterpartyName: name.trim(),
    walletNumber: account,
    occurredLocal: `${year}-${month}-${day} ${two(hour)}:${minute}:00`,
    reference: reference.toLowerCase(),
    complete: Boolean(amount && reference),
  };
};

export const parseTransferSms = (raw = "") => {
  const cib = parseCibSms(raw);
  if (cib) return cib;
  const united = parseUnitedBankSms(raw);
  if (united) return united;
  const vodafone = parseVodafoneCashSms(raw);
  if (vodafone.kind !== "unknown") return { provider: "vodafone_cash", ...vodafone };
  return empty("unknown", { reference: vodafone.reference });
};

// A forged SMS can carry the same words, so only the sender iOS names for that source may
// confirm an order on its own. Anything else waits for a person.
const TRUSTED_SENDERS = {
  vodafone_cash: /vf|vodafone|فودافون/i,
  cib: /cib|التجاري/i,
  united_bank: /united|المتحد|ubank/i,
};
export const isTrustedTransferSender = (provider = "", sender = "") =>
  Boolean(TRUSTED_SENDERS[provider]?.test(String(sender || "")));
