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
  templateDefinition,
  templateNeedsImageSample,
  templateSubmissionPayload,
} from "../../services/whatsappTemplates.js";
import {
  ensureWhatsappTemplateSchema,
  resolveTemplateCredentials,
  syncTemplates,
  uploadHeaderSample,
} from "../../services/whatsappTemplateStudioService.js";
import { absolutePublicUploadUrl } from "../../utils/publicUrl.js";

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

export const listAutomationTemplates = async ({ tenantId }) => {
  const rows = await rowsByName(tenantId);
  return Object.keys(WHATSAPP_TEMPLATE_DEFINITIONS).map((key) => {
    const definition = templateDefinition(key);
    const row = rows.get(definition.name) || null;
    return {
      automation_type: key,
      name: definition.name,
      purpose: purposeOf(key),
      category: text(row?.category) || definition.category,
      status: text(row?.status) || "NOT_SUBMITTED",
      rejection_reason: text(row?.rejection_reason),
      buttons: (definition.buttons || []).map((button) => button.text || button.type),
      carousel_cards: definition.carousel?.cards || 0,
      header: definition.header?.format || "",
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
  const wanted = (Array.isArray(keys) && keys.length ? keys : Object.keys(WHATSAPP_TEMPLATE_DEFINITIONS))
    .map(text)
    .filter((key) => templateDefinition(key));
  const current = await listAutomationTemplates({ tenantId });
  const statusOf = new Map(current.map((item) => [item.automation_type, item.status]));
  const pending = wanted.filter((key) => SUBMITTABLE.has(statusOf.get(key) || "NOT_SUBMITTED"));

  let headerHandle = "";
  if (pending.some(templateNeedsImageSample)) {
    const sample = await sampleImageBuffer();
    headerHandle = (await uploadHeaderSample({ tenantId, ...sample })).handle;
  }

  const results = [];
  for (const key of pending) {
    const payload = templateSubmissionPayload(key, { headerHandle });
    try {
      const response = await graphRequest({
        path: `/${credentials.graphVersion}/${credentials.wabaId}/message_templates`,
        method: "POST",
        body: payload,
        accessToken: credentials.accessToken,
      });
      results.push({ automation_type: key, name: payload.name, ok: true, status: text(response?.status) || "PENDING", category: text(response?.category) });
    } catch (error) {
      results.push({
        automation_type: key,
        name: payload.name,
        ok: false,
        error: text(error?.details?.error_user_msg || error?.details?.meaning || error?.message) || "Meta refused the template",
      });
    }
  }
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
