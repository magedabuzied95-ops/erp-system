import { governorateOptions, normalizeCodPolicy, resolveCodPolicy, resolveGovernorateId } from "../../shared/codPolicy.js";
import { getSetting } from "./settingsService.js";
import { loadCodPolicySettings, resolveStorefrontShippingQuote } from "./storefrontShippingService.js";

// What the customer is TOLD about the closing system, in one place: the AI's "how do I
// pay" answer, its order summaries and confirmations, and the WhatsApp confirmation
// request. The rule itself is shared/codPolicy.js; this only words it. Under the open
// system every function returns "" so the existing replies stay exactly as they were.

const text = (value = "") => String(value ?? "").trim();
const PLACEHOLDER_NUMBERS = new Set(["", "01000000000"]);
const PLACEHOLDER_HANDLES = new Set(["", "01000000000@instapay"]);

const formatMoney = (value) => Math.round(Number(value) || 0).toLocaleString("en-US");

const codGovernorateNames = (policy) =>
  normalizeCodPolicy(policy).governorates
    .map((id) => governorateOptions.find((option) => option.value === id)?.ar)
    .filter(Boolean)
    .join(" و");

// "للقاهرة", "لدمياط" — the preposition joins the name the way it is written, never "لـالقاهرة".
export const toPlace = (name = "") => {
  const place = text(name);
  if (!place) return "";
  return place.startsWith("ال") ? `لل${place.slice(2)}` : `ل${place}`;
};

const governorateName = (value) => {
  const id = resolveGovernorateId(value);
  return governorateOptions.find((option) => option.value === id)?.ar || text(value);
};

export const loadTransferDetails = async () => {
  const [vodafoneA, vodafoneB, instapayUrl, instapayHandleA, instapayHandleB] = await Promise.all([
    getSetting("storefront.payment_methods.vodafone_cash_number", ""),
    getSetting("payments.vodafone_cash_number", ""),
    getSetting("storefront.payment_methods.instapay.payment_url", ""),
    getSetting("storefront.payment_methods.instapay_handle", ""),
    getSetting("payments.instapay_handle", ""),
  ]);
  const vodafone = [vodafoneA, vodafoneB].map(text).find((value) => !PLACEHOLDER_NUMBERS.has(value)) || "";
  const instapay = [instapayUrl, instapayHandleA, instapayHandleB].map(text).find((value) => !PLACEHOLDER_HANDLES.has(value)) || "";
  return { vodafone, instapay };
};

export const transferDetailLines = ({ vodafone = "", instapay = "" } = {}) => [
  vodafone && `📱 فودافون كاش: ${vodafone}`,
  instapay && `🏦 InstaPay: ${instapay}`,
].filter(Boolean);

/**
 * Pure wording, so it can be tested without settings. `policy` is the loaded
 * { mode, governorates }; returns "" when nothing has to be prepaid.
 */
export const buildShippingFeeAdvanceNotice = ({ policy, governorate = "", governorateId = "", shippingFee = 0, orderTotal = 0, transfer = {}, compact = false } = {}) => {
  const cod = resolveCodPolicy({ policy, governorate, governorateId, shippingFee, orderTotal });
  if (cod.cod_allowed) return "";
  const fee = formatMoney(cod.advance_amount);
  const rest = Math.max(0, Number(orderTotal) - cod.advance_amount);
  const where = governorateName(governorate || governorateId);
  const codList = codGovernorateNames(policy);
  if (compact) {
    return `💳 رسوم الشحن ${fee} جنيه تتحوّل مقدّم قبل الشحن${rest > 0 ? `، والباقي ${formatMoney(rest)} جنيه عند الاستلام` : ""}.`;
  }
  return [
    `💳 الدفع عند الاستلام متاح ${codList ? `لمحافظة ${codList} بس` : "لمحافظات معيّنة بس"}. عشان نشحن طلبك${where ? ` ${toPlace(where)}` : ""} لازم تحوّل رسوم الشحن ${fee} جنيه الأول${rest > 0 ? `، والباقي ${formatMoney(rest)} جنيه تدفعه عند الاستلام` : ""}.`,
    ...transferDetailLines(transfer),
    "📸 ابعت صورة التحويل هنا وهنأكد الطلب ونشحنه على طول.",
  ].join("\n");
};

export const shippingFeeAdvanceNoticeFor = async ({ governorate = "", governorateId = "", shippingFee = 0, orderTotal = 0, compact = false } = {}) => {
  try {
    const policy = await loadCodPolicySettings();
    if (normalizeCodPolicy(policy).mode !== "restricted") return "";
    const transfer = compact ? {} : await loadTransferDetails();
    return buildShippingFeeAdvanceNotice({ policy, governorate, governorateId, shippingFee, orderTotal, transfer, compact });
  } catch (error) {
    console.warn("[cod-policy-reply] notice skipped", { message: error?.message || String(error) });
    return "";
  }
};

// Before an order exists (a summary asking "أأكد الطلب؟"): price the fee from the address.
export const shippingFeeAdvanceNoticeForAddress = async ({ governorate = "", subtotal = 0, compact = true } = {}) => {
  if (!text(governorate)) return "";
  try {
    const policy = await loadCodPolicySettings();
    if (normalizeCodPolicy(policy).mode !== "restricted") return "";
    const quote = await resolveStorefrontShippingQuote({ governorate, subtotal });
    const fee = Number(quote?.price) || 0;
    return shippingFeeAdvanceNoticeFor({ governorate, shippingFee: fee, orderTotal: (Number(subtotal) || 0) + fee, compact });
  } catch (error) {
    console.warn("[cod-policy-reply] address notice skipped", { message: error?.message || String(error) });
    return "";
  }
};

export const shippingFeeAdvanceNoticeForOrder = (order = {}, options = {}) =>
  shippingFeeAdvanceNoticeFor({
    governorate: order.governorate || order.shipping_city_name_ar || order.shipping_city_name_en || "",
    governorateId: order.governorate_id || "",
    shippingFee: order.shipping_fee ?? order.delivery_fee ?? order.shipping_cost ?? 0,
    orderTotal: order.total_amount ?? order.total_price ?? order.total ?? 0,
    ...options,
  });

/** The "how do I pay / is COD available" answer while the restricted system is on; "" otherwise. */
export const buildRestrictedCodFaqAnswer = ({ policy, transfer = {} } = {}) => {
  if (normalizeCodPolicy(policy).mode !== "restricted") return "";
  const codList = codGovernorateNames(policy);
  return [
    `الدفع عند الاستلام متاح ${codList ? `لمحافظة ${codList}` : "لمحافظات معيّنة"} 👌`,
    "لباقي المحافظات بتحوّل رسوم الشحن بس مقدّم، والباقي بتدفعه عند الاستلام.",
    ...transferDetailLines(transfer),
  ].join("\n");
};

export const restrictedCodFaqAnswer = async () => {
  try {
    const policy = await loadCodPolicySettings();
    if (normalizeCodPolicy(policy).mode !== "restricted") return "";
    return buildRestrictedCodFaqAnswer({ policy, transfer: await loadTransferDetails() });
  } catch (error) {
    console.warn("[cod-policy-reply] faq answer skipped", { message: error?.message || String(error) });
    return "";
  }
};

/**
 * The one "is there cash on delivery / how do I pay" answer, decided by the settings switch
 * alone — the free-text COD reply in the AI settings no longer overrides it, so an old
 * "دمياط بس" typed there cannot contradict the open system (owner decision 2026-09-15).
 */
export const buildCodFaqAnswer = ({ policy, codEnabled = true, transfer = {} } = {}) => {
  if (!codEnabled) {
    return ["الدفع عند الاستلام مش متاح حالياً، الدفع بيكون بتحويل قبل الشحن.", ...transferDetailLines(transfer)].join("\n");
  }
  return buildRestrictedCodFaqAnswer({ policy, transfer }) || "أيوه، الدفع عند الاستلام متاح لكل المحافظات 👌";
};

export const codFaqAnswer = async () => {
  try {
    const [policy, codEnabled, transfer] = await Promise.all([
      loadCodPolicySettings(),
      getSetting("orders.allow_cod", true),
      loadTransferDetails(),
    ]);
    const enabled = !(codEnabled === false || ["false", "0", "off", "no"].includes(String(codEnabled).trim().toLowerCase()));
    return buildCodFaqAnswer({ policy, codEnabled: enabled, transfer });
  } catch (error) {
    console.warn("[cod-policy-reply] cod answer fell back", { message: error?.message || String(error) });
    return "أيوه، الدفع عند الاستلام متاح 👌";
  }
};

/** Facts for the AI tools / prompt, so the model and the reply validator see the same rule. */
export const codPolicyFacts = async () => {
  const policy = normalizeCodPolicy(await loadCodPolicySettings());
  return {
    mode: policy.mode,
    cod_governorates: policy.governorates.map((id) => governorateOptions.find((option) => option.value === id)?.ar || id),
    other_governorates: policy.mode === "restricted" ? "transfer the shipping fee in advance, rest cash on delivery" : "cash on delivery",
  };
};
