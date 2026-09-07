/*
 * "This answer was wrong" — the correction the AI learns from.
 *
 * Shared by /admin/ai-inbox and the /inbox PWA. It used to exist only on the
 * desktop, so a wrong answer spotted on the phone had nowhere to go and the
 * learning loop simply lost it.
 */
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { asArray, clean, normalizeProductCardsValue } from "../lib/conversationHelpers";

// A filter descriptor carries either a translation key or a literal label.
const filterLabel = (t, item = {}) => (item.labelKey ? t(item.labelKey) : item.label || "");

export const replyCorrectionTypes = [
  { value: "wrong_price", label: "wrong_price" },
  { value: "wrong_stock", label: "wrong_stock" },
  { value: "wrong_policy", label: "wrong_policy" },
  { value: "bad_tone", label: "bad_tone" },
  { value: "incomplete_answer", label: "incomplete_answer" },
  { value: "other", label: "other" },
];

// The correction is only useful with the question it answered, so the customer
// message immediately before the AI reply travels with it.
export const buildReplyCorrectionDraft = ({ conversation = {}, message = {} } = {}) => {
  const messages = asArray(conversation.messages);
  const index = messages.findIndex((item) => String(item.id || item.external_message_id || item.external_reply_id || "") === String(message.id || message.external_message_id || message.external_reply_id || ""));
  const previousCustomerMessage = index >= 0
    ? [...messages.slice(0, index)].reverse().find((item) => clean(item.customer_message || item.message_text || item.last_message || ""))
    : null;
  const customerQuestion = clean(
    previousCustomerMessage?.customer_message ||
      previousCustomerMessage?.message_text ||
      previousCustomerMessage?.last_message ||
      message.customer_message ||
      message.message_text ||
      ""
  );
  const aiWrongAnswer = clean(message.ai_answer || message.staff_message || "");
  const productId = clean(message.clicked_product_id || normalizeProductCardsValue(message.suggested_products)[0]?.id || message.product_id || message.current_product_id || "");
  return {
    conversationId: clean(conversation.session_id || conversation.conversation_id || ""),
    messageId: clean(message.id || message.external_message_id || message.external_reply_id || ""),
    channel: clean(conversation.channel || conversation.source || message.channel || ""),
    productId,
    customerQuestion,
    aiWrongAnswer,
    employeeCorrectAnswer: "",
    correctionType: "other",
  };
};

function ReplyCorrectionModal({ open, draft, saving, onClose, onChange, onSave }) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 px-3 py-4 backdrop-blur-sm md:items-center">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-slate-950/98 p-4 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-200">{t("aiSupport.inbox.panel.correctionMemory")}</div>
            <h3 className="mt-1 text-lg font-black text-white">{t("aiSupport.inbox.panel.correctionTitle")}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.panel.customerQuestion")}</div>
            <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-7 text-slate-100">
              {clean(draft.customerQuestion) || "غير متاح"}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.panel.oldAiReply")}</div>
            <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-7 text-slate-100">
              {clean(draft.aiWrongAnswer) || "غير متاح"}
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="block">
            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.panel.correctReply")}</div>
            <textarea
              value={draft.employeeCorrectAnswer}
              onChange={(event) => onChange({ employeeCorrectAnswer: event.target.value })}
              rows={5}
              placeholder={t("aiSupport.inbox.panel.correctionPlaceholder")}
              className="min-h-36 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm font-medium leading-7 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
            />
          </label>
          <div className="space-y-3">
            <label className="block">
              <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.panel.correctionType")}</div>
              <select
                value={draft.correctionType}
                onChange={(event) => onChange({ correctionType: event.target.value })}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-sm font-black text-white outline-none focus:border-cyan-300/40"
              >
                {replyCorrectionTypes.map((item) => (
                  <option key={item.value} value={item.value}>{filterLabel(t, item)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.panel.productIdOptional")}</div>
              <input
                value={draft.productId}
                onChange={(event) => onChange({ productId: event.target.value })}
                placeholder="123"
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-sm font-black text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
              />
            </label>
            <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/8 p-3 text-xs leading-6 text-cyan-100">
              التصحيح يُحفظ كذاكرة داخلية فقط. لن يتم إرسال أي رسالة للعميل، ولن يتم تعديل الرسالة القديمة.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm font-black text-slate-100">
            إلغاء
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !clean(draft.employeeCorrectAnswer)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            حفظ التصحيح
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReplyCorrectionModal;
