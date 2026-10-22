/*
 * The automation templates (server/services/whatsappTemplates.js) on Meta, in one place.
 *
 * Every message the store sends by itself — order confirmation, the shipping-fee card, shipping
 * updates, the abandoned-cart and campaign carousels — has a registry definition. On the official
 * number a message outside the 24h window can ONLY leave as one of them, and a few cards (the
 * payment card's copy button, two link buttons) can only be drawn by one, so each has to exist on
 * the number's WABA and be APPROVED. This file lists them with Meta's verdict and submits the ones
 * Meta does not have yet; the template studio's sync brings the verdicts back as rows.
 */

import db from "../../database/db.js";
import { graphRequest } from "../../services/whatsappCloudProvider.js";
import {
  WHATSAPP_TEMPLATE_DEFINITIONS,
  TEMPLATE_LANGUAGE,
  TEMPLATE_EDIT_LIMITS,
  baseTemplateDefinition,
  editableButton,
  templateDefinition,
  templateNeedsImageSample,
  templateSubmissionPayload,
} from "../../services/whatsappTemplates.js";
import { markTemplatesSubmitted, refreshTemplateOverrides } from "./templateOverrides.js";
import {
  ensureWhatsappTemplateSchema,
  resolveTemplateCredentials,
  syncTemplates,
  uploadHeaderSample,
} from "../../services/whatsappTemplateStudioService.js";
import { absolutePublicUploadUrl } from "../../utils/publicUrl.js";
import { automationRoute } from "../../services/whatsappQueue/index.js";

/*
 * The cost policy (owner, 2026-10-21): order messages leave from Evolution for free, so only the
 * MARKETING templates go to Meta. The order ones stay defined (and submittable by name) in case
 * the policy is switched off with WHATSAPP_TRANSACTIONAL_VIA_EVOLUTION=false.
 */
const policyOn = () => String(process.env.WHATSAPP_TRANSACTIONAL_VIA_EVOLUTION ?? "").trim().toLowerCase() !== "false";
// A template is needed on Meta only when its message is routed to the official number (or to
// "the customer's number", which may be the official one). Carousels always: campaigns use them.
const sentByEvolution = async (key) => {
  if (!policyOn() || key.startsWith("product_carousel_")) return false;
  return (await automationRoute(key)).route === "evolution";
};

const text = (value = "") => String(value ?? "").trim();

/* What each automation is, for the list (the registry key is the automation type). */
const PURPOSE = Object.freeze({
  order_confirmation: "تأكيد الطلب (تأكيد / تعديل / إلغاء)",
  payment_review: "الطلب في مراجعة الدفع",
  invoice_receipt: "الفاتورة + تقييم جوجل",
  shipping_fee_payment_card: "كارت دفع الشحن (انسخ الرقم + ارفع التحويل)",
  payment_proof_received: "استلمنا صورة التحويل",
  payment_proof_approved: "وصلنا الدفع (فاتورتك + تابع طلبك)",
  shipment_created: "تم إنشاء الشحنة",
  shipped: "تم الشحن",
  out_for_delivery: "خارج للتسليم",
  delivered: "تم التسليم + تقييم جوجل",
  delivery_failed: "محاولة تسليم فشلت",
  google_review_request: "طلب تقييم جوجل",
  thank_you: "رسالة شكر",
  abandoned_cart: "السلة المتروكة (نص)",
  price_drop_alert: "السعر نزل (صورة المنتج)",
  product_review_request: "قيّم مشترياتك",
});
/* What each {{n}} carries, so the editor can say "{{3}} = the amount to collect". */
const VARIABLE_LABELS = Object.freeze({
  customer_name: "اسم العميل",
  order_number: "رقم الطلب",
  cod_amount: "مبلغ التحصيل",
  items_summary: "المنتجات",
  address: "عنوان التوصيل",
  invoice_url: "رابط الفاتورة",
  advance_amount: "المبلغ المطلوب تحويله",
  remaining_amount: "الباقي عند الاستلام",
  wallet_number: "رقم التحويل",
  advance_label: "نوع المبلغ (مثلاً رسوم الشحن)",
  payment_label: "نوع المبلغ (مثلاً رسوم الشحن)",
  shipping_line: "سطر حالة الشحن",
  collect_line: "سطر مبلغ التحصيل",
  provider: "شركة الشحن",
  tracking_number: "رقم التتبع",
  tracking_url: "رابط التتبع",
  failure_reason: "سبب فشل التسليم",
  review_url: "رابط التقييم",
  cart_url: "رابط السلة",
  product_name: "اسم المنتج",
  old_price: "السعر القديم",
  new_price: "السعر الجديد",
  price: "السعر",
  intro_text: "جملة الحملة",
});
const variablesOf = (names = [], samples = []) =>
  names.map((name, index) => ({ position: index + 1, name, label: VARIABLE_LABELS[name] || name, sample: text(samples[index]) }));

/*
 * The editor's form: the wording that can change (header text, body, footer, button labels, the
 * carousel card) and, for each {{n}}, what it carries. Buttons keep their type — only the label
 * is the owner's — and a copy-code button's label is Meta's, so it is listed but locked.
 */
const buttonsForm = (buttons = []) => buttons.map((button) => ({ type: button.type, text: text(button.text), editable: editableButton(button) }));
const formOf = (definition) => ({
  header_text: definition.header?.format === "TEXT" ? text(definition.header.text) : null,
  body: definition.body,
  footer: text(definition.footer),
  buttons: buttonsForm(definition.buttons || []),
  variables: variablesOf(definition.variables, definition.samples),
  card_body: definition.carousel ? definition.carousel.card.body : null,
  card_buttons: definition.carousel ? buttonsForm(definition.carousel.card.buttons) : [],
  card_variables: definition.carousel ? variablesOf(definition.carousel.card.variables, definition.carousel.card.samples) : [],
});

const purposeOf = (key = "") => PURPOSE[key] || (key.startsWith("product_carousel_")
  ? `كاروسيل منتجات — ${templateDefinition(key)?.carousel?.cards || ""} كروت (حملات / سلة متروكة)`
  : key);

const rowsByName = async (tenantId) => {
  await ensureWhatsappTemplateSchema();
  const result = await db.query(
    `SELECT name, status, rejection_reason, meta_template_id, category FROM whatsapp_message_templates
      WHERE tenant_id = $1 AND language = $2`,
    [tenantId, TEMPLATE_LANGUAGE]
  );
  return new Map(result.rows.map((row) => [text(row.name), row]));
};

const previewButton = (button) => ({ type: button.type, text: text(button.text) });

/* A real product photo for the preview's image header and carousel cards. */
const samplePhotoUrl = async () => {
  const result = await db.query(
    `SELECT image_url FROM products WHERE COALESCE(image_url, '') <> '' ORDER BY id DESC LIMIT 1`
  ).catch(() => ({ rows: [] }));
  return absolutePublicUploadUrl(result.rows[0]?.image_url || "");
};

/*
 * The template as the customer's phone shows it, in the studio preview's own shape: the body with
 * its samples, header, footer, buttons — and for a carousel, the card every slide repeats.
 */
const previewOf = (definition, photo = "") => ({
  header_format: definition.header?.format || "NONE",
  header_text: definition.header?.format === "TEXT" ? text(definition.header.text) : "",
  header_media_url: definition.header?.format === "IMAGE" ? photo : "",
  body_text: definition.body,
  body_examples: definition.samples || [],
  footer_text: text(definition.footer),
  buttons: (definition.buttons || []).map(previewButton),
  carousel: definition.carousel
    ? {
      cards: definition.carousel.cards,
      image_url: photo,
      body_text: definition.carousel.card.body,
      body_examples: definition.carousel.card.samples || [],
      buttons: definition.carousel.card.buttons.map(previewButton),
    }
    : null,
});

export const listAutomationTemplates = async ({ tenantId }) => {
  const overrides = new Map((await refreshTemplateOverrides()).map((row) => [text(row.automation_type), row]));
  const rows = await rowsByName(tenantId);
  const photo = await samplePhotoUrl();
  const keys = Object.keys(WHATSAPP_TEMPLATE_DEFINITIONS);
  const viaEvolution = new Map(await Promise.all(keys.map(async (key) => [key, await sentByEvolution(key)])));
  return keys.map((key) => {
    const definition = templateDefinition(key);
    const row = rows.get(definition.name) || null;
    const override = overrides.get(key) || null;
    // Meta holds the old wording until the edit is sent there too.
    const needsResubmit = Boolean(override?.needs_resubmit && text(row?.meta_template_id));
    return {
      automation_type: key,
      name: definition.name,
      purpose: purposeOf(key),
      category: text(row?.category) || definition.category,
      status: needsResubmit ? "EDITED" : text(row?.status) || (viaEvolution.get(key) ? "VIA_EVOLUTION" : "NOT_SUBMITTED"),
      meta_status: text(row?.status),
      on_meta: Boolean(text(row?.meta_template_id)),
      edited: Boolean(override?.edit),
      needs_resubmit: needsResubmit,
      form: formOf(definition),
      default_form: formOf(baseTemplateDefinition(key)),
      limits: TEMPLATE_EDIT_LIMITS,
      via_evolution: viaEvolution.get(key),
      rejection_reason: text(row?.rejection_reason),
      buttons: (definition.buttons || []).map((button) => button.text || button.type),
      carousel_cards: definition.carousel?.cards || 0,
      header: definition.header?.format || "",
      preview: previewOf(definition, photo),
    };
  });
};

/*
 * One sample photo serves every image header and every carousel card: Meta only reviews that the
 * format is right. A real product photo, so the reviewer sees what customers will see.
 */
const sampleImageBuffer = async () => {
  const result = await db.query(
    `SELECT image_url FROM products
      WHERE COALESCE(image_url, '') <> '' AND COALESCE(is_active, true) = true
      ORDER BY id DESC LIMIT 5`
  ).catch(() => ({ rows: [] }));
  for (const row of result.rows) {
    const url = absolutePublicUploadUrl(row.image_url);
    if (!/^https:\/\//i.test(url)) continue;
    try {
      const response = await fetch(url);
      const type = text(response.headers.get("content-type")).toLowerCase();
      if (!response.ok || !/^image\/(jpeg|png)/.test(type)) continue;
      return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: type.split(";")[0], fileName: "product-sample.jpg" };
    } catch {
      // try the next photo
    }
  }
  throw Object.assign(new Error("No public JPEG/PNG product photo was found to use as the template sample"), { status: 409, code: "WHATSAPP_TEMPLATE_SAMPLE_MISSING" });
};

const SUBMITTABLE = new Set(["NOT_SUBMITTED", "DRAFT", "REJECTED"]);

/*
 * Submit what Meta does not have yet (or rejected). `keys` narrows it to some automations; empty
 * means all. Each template is its own request, so one refusal never stops the rest — its reason
 * comes back in `results`.
 */
export const submitAutomationTemplates = async ({ tenantId, keys = [] } = {}) => {
  const credentials = await resolveTemplateCredentials(tenantId);
  const current = await listAutomationTemplates({ tenantId });
  const wanted = (Array.isArray(keys) && keys.length ? keys : current.filter((item) => !item.via_evolution).map((item) => item.automation_type))
    .map(text)
    .filter((key) => templateDefinition(key));
  const statusOf = new Map(current.map((item) => [item.automation_type, item.status]));
  // An edited template Meta already holds is part of "what Meta does not have yet": its wording.
  const pending = wanted.filter((key) => SUBMITTABLE.has(statusOf.get(key) || "NOT_SUBMITTED") || statusOf.get(key) === "EDITED");
  const metaRows = await rowsByName(tenantId);

  let headerHandle = "";
  if (pending.some(templateNeedsImageSample)) {
    const sample = await sampleImageBuffer();
    headerHandle = (await uploadHeaderSample({ tenantId, ...sample })).handle;
  }

  const results = [];
  for (const key of pending) {
    const payload = templateSubmissionPayload(key, { headerHandle });
    /*
     * A template Meta already holds is EDITED in place (POST /{template-id}, components only — the
     * name, language and category of an existing template are frozen). Meta allows an approved
     * template one edit a day and ten in thirty days; a refusal for that comes back as the reason.
     */
    const existingId = text(metaRows.get(payload.name)?.meta_template_id);
    const editInPlace = Boolean(existingId);
    try {
      const response = await graphRequest({
        path: editInPlace
          ? `/${credentials.graphVersion}/${existingId}`
          : `/${credentials.graphVersion}/${credentials.wabaId}/message_templates`,
        method: "POST",
        body: editInPlace ? { components: payload.components } : payload,
        accessToken: credentials.accessToken,
      });
      results.push({ automation_type: key, name: payload.name, ok: true, edited: editInPlace, status: text(response?.status) || "PENDING", category: text(response?.category) });
    } catch (error) {
      results.push({
        automation_type: key,
        name: payload.name,
        ok: false,
        error: text(error?.details?.error_user_msg || error?.details?.meaning || error?.message) || "Meta refused the template",
      });
    }
  }
  await markTemplatesSubmitted(results.filter((item) => item.ok).map((item) => item.automation_type)).catch(() => {});
  // Bring Meta's verdicts (and the new templates) back as rows the studio and the worker read.
  const sync = await syncTemplates({ tenantId }).catch((error) => ({ error: error?.message || String(error) }));
  return {
    submitted: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    skipped: wanted.length - pending.length,
    results,
    sync,
    templates: await listAutomationTemplates({ tenantId }),
  };
};
