import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, Plus, Receipt, RotateCcw, Save, Trash2, X } from "lucide-react";

import { api } from "../../../shared/api/api";
import {
  WHATSAPP_AUTOMATION_LABELS,
  WHATSAPP_AUTOMATION_TYPES,
  WHATSAPP_MESSAGE_VARIANT_DEFAULTS,
  WHATSAPP_QUEUE_PLACEHOLDERS,
  normalizeWhatsappMessageVariants,
  renderWhatsappTemplate,
} from "../../../../shared/whatsappQueueDefaults.js";

/*
 * The wordings the WhatsApp queue rotates through, edited where the operator already lives.
 *
 * One setting — whatsapp.message_variants — holds a list per automation type. The queue picks
 * round robin over the enabled ones, so with five receipt wordings customer 6 gets the same text
 * as customer 1. What is saved here is the whole map, empty lists included: an empty list is how
 * the built-in wordings for a type are switched off, so it must reach the server as [] and not
 * disappear on the way.
 */
const SETTING_KEY = "whatsapp.message_variants";
const SETTINGS_CATEGORY = "ai_channels";

const SAMPLE_VALUES = Object.freeze({
  customer_name: "أحمد",
  invoice_number: "INV-1042",
  invoice_url: "https://m1store-egy.com/invoice/INV-1042",
  order_number: "M1-9001",
  google_review_url: "https://g.page/r/example/review",
  provider: "Bosta",
  tracking_number: "BST123456",
  tracking_url: "https://bosta.co/tracking/BST123456",
  cod_amount: "1,250.00",
  store_name: "M1 Store",
  total: "1,250.00",
});

const newVariantId = (type, existing = []) => {
  const taken = new Set(existing.map((variant) => variant.id));
  let index = existing.length;
  let id = `${type}-${String.fromCharCode(97 + (index % 26))}`;
  while (taken.has(id)) {
    index += 1;
    id = `${type}-${String.fromCharCode(97 + (index % 26))}${index >= 26 ? `-${index}` : ""}`;
  }
  return id;
};

const blankVariant = (type, existing = []) => ({
  id: newVariantId(type, existing),
  label: "",
  enabled: true,
  title: "",
  body: "",
});

const cloneDefaults = (type) => (WHATSAPP_MESSAGE_VARIANT_DEFAULTS[type] || []).map((variant) => ({ ...variant }));

/*
 * The gear-menu home of the editor: "إعدادات رسائل الفواتير" in the AI Inbox. Same shell as the
 * comments-settings modal so the two read as one family. Opens on the invoice receipt, because
 * that is the message the operator came for; the type picker inside reaches the others.
 */
export function WhatsappMessageVariantsModal({ open, onClose, initialType = "invoice_receipt" }) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[#17130d]/60 p-3 backdrop-blur-sm md:items-center"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section dir="rtl" className="m1-ai-scope flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-amber-300/15 bg-[#181a18] text-white shadow-[0_30px_100px_rgba(47,35,12,0.36)]">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#171917] px-4 py-4 md:px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400/10 text-amber-200"><Receipt className="h-5 w-5" /></span>
            <div>
              <div className="text-lg font-black">{t("aiSupport.aiSettings.variants.menuTitle")}</div>
              <div className="text-xs text-slate-400">{t("aiSupport.aiSettings.variants.subtitle")}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("aiSupport.aiSettings.variants.close")} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-slate-300 transition hover:bg-white/10"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-black/10 p-3 md:p-4">
          <WhatsappMessageVariantsEditor initialType={initialType} />
        </div>
      </section>
    </div>
  );
}

export default function WhatsappMessageVariantsEditor({ initialType = "invoice_receipt" }) {
  const { t, i18n } = useTranslation();
  const lang = String(i18n?.language || "ar").startsWith("ar") ? "ar" : "en";
  const [type, setType] = useState(initialType);
  const [variantsByType, setVariantsByType] = useState({});
  // What the server actually holds, key for key. A type the operator switched off is stored as
  // [] and the normalizer drops it from view; saving another type must not lose that [] on the
  // way back, or the built-ins would quietly come back on.
  const [storedRaw, setStoredRaw] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get(`/settings/${SETTINGS_CATEGORY}`, { perfComponent: "WhatsappMessageVariantsEditor.load" });
      const row = (Array.isArray(payload?.settings) ? payload.settings : []).find((item) => item?.key === SETTING_KEY);
      // The normalizer fills a never-saved type with its built-ins, so what the operator sees is
      // exactly what the queue would send right now.
      setVariantsByType(normalizeWhatsappMessageVariants(row?.value));
      setStoredRaw(row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : {});
      setDirty(false);
    } catch (err) {
      setError(err?.message || t("aiSupport.aiSettings.variants.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const variants = variantsByType[type] || [];
  const hasDefaults = (WHATSAPP_MESSAGE_VARIANT_DEFAULTS[type] || []).length > 0;
  const enabledCount = variants.filter((variant) => variant.enabled !== false && String(variant.body || "").trim()).length;

  const setList = (next) => {
    setVariantsByType((current) => ({ ...current, [type]: next }));
    setDirty(true);
    setToast("");
  };
  const patchVariant = (index, updates) => setList(variants.map((variant, i) => (i === index ? { ...variant, ...updates } : variant)));
  const removeVariant = (index) => setList(variants.filter((_, i) => i !== index));
  const addVariant = () => setList([...variants, blankVariant(type, variants)]);
  const restoreDefaults = () => setList(cloneDefaults(type));

  const save = async () => {
    setSaving(true);
    setError("");
    setToast("");
    try {
      // Whole map, including types emptied on purpose: [] is a decision, absence is not.
      const value = Object.fromEntries(Object.entries({ ...storedRaw, ...variantsByType }).map(([key, list]) => [
        key,
        (Array.isArray(list) ? list : [])
          .map((variant) => ({
            id: String(variant.id || "").trim(),
            label: String(variant.label || "").trim(),
            enabled: variant.enabled !== false,
            title: String(variant.title || "").trim(),
            body: String(variant.body || "").trim(),
          }))
          .filter((variant) => variant.body),
      ]));
      const payload = await api.put(`/settings/${SETTINGS_CATEGORY}`, { settings: { [SETTING_KEY]: value } }, { perfComponent: "WhatsappMessageVariantsEditor.save" });
      const row = (Array.isArray(payload?.settings) ? payload.settings : []).find((item) => item?.key === SETTING_KEY);
      // Re-read what the server kept, but keep the operator's explicit empty lists visible: the
      // normalizer would otherwise show the built-ins for a type they just switched off.
      const normalized = normalizeWhatsappMessageVariants(row?.value ?? value);
      setVariantsByType({ ...normalized, ...Object.fromEntries(Object.entries(value).filter(([, list]) => !list.length)) });
      setStoredRaw(value);
      setDirty(false);
      setToast(t("aiSupport.aiSettings.variants.saved"));
    } catch (err) {
      setError(err?.message || t("aiSupport.aiSettings.variants.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = useMemo(() => Object.keys(WHATSAPP_AUTOMATION_TYPES).map((key) => ({
    value: key,
    label: WHATSAPP_AUTOMATION_LABELS[key]?.[lang] || WHATSAPP_AUTOMATION_LABELS[key]?.en || key,
  })), [lang]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <label className="grid gap-1 text-xs font-bold text-slate-400">
          {t("aiSupport.aiSettings.variants.typeLabel")}
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-[var(--control-height)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white"
          >
            {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-xs font-bold text-slate-300">
            {t("aiSupport.aiSettings.variants.activeCount", { count: enabledCount })}
          </span>
          {hasDefaults ? (
            <button type="button" onClick={restoreDefaults} className="inline-flex h-[var(--control-height)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-slate-950/55 px-3 text-xs font-black text-white hover:border-white/20">
              <RotateCcw className="h-4 w-4" />{t("aiSupport.aiSettings.variants.restoreDefaults")}
            </button>
          ) : null}
          <button type="button" onClick={addVariant} className="inline-flex h-[var(--control-height)] items-center gap-2 rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 px-3 text-xs font-black text-primary hover:bg-primary/15">
            <Plus className="h-4 w-4" />{t("aiSupport.aiSettings.variants.add")}
          </button>
          <button type="button" onClick={save} disabled={loading || saving || !dirty} className="inline-flex h-[var(--control-height)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-slate-950 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("aiSupport.aiSettings.variants.save")}
          </button>
        </div>
      </div>

      <p className="text-xs leading-5 text-slate-400">
        {t("aiSupport.aiSettings.variants.help")}{" "}
        <span className="font-mono text-slate-300">{WHATSAPP_QUEUE_PLACEHOLDERS.map((item) => `{{${item.token}}}`).join("  ")}</span>
      </p>

      {toast ? <div className="flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100"><CheckCircle2 className="h-4 w-4" />{toast}</div> : null}
      {error ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("aiSupport.aiSettings.variants.loading")}</div>
      ) : variants.length === 0 ? (
        <div className="rounded-[var(--radius-control)] border border-dashed border-white/15 bg-slate-950/40 p-4 text-sm text-slate-400">
          {t("aiSupport.aiSettings.variants.empty")}
        </div>
      ) : (
        <div className="grid gap-3">
          {variants.map((variant, index) => {
            const previewTitle = renderWhatsappTemplate(variant.title || "", SAMPLE_VALUES);
            const previewBody = renderWhatsappTemplate(variant.body || "", SAMPLE_VALUES);
            const disabled = variant.enabled === false;
            return (
              <div key={variant.id || index} className={`grid gap-3 rounded-[var(--radius-control)] border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] ${disabled ? "border-white/10 bg-slate-950/35 opacity-70" : "border-white/10 bg-slate-950/55"}`}>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      value={variant.label || ""}
                      onChange={(event) => patchVariant(index, { label: event.target.value })}
                      placeholder={t("aiSupport.aiSettings.variants.labelPlaceholder", { n: index + 1 })}
                      dir="auto"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white"
                    />
                    <button
                      type="button"
                      onClick={() => patchVariant(index, { enabled: disabled })}
                      className={`h-9 shrink-0 rounded-lg border px-3 text-xs font-black ${disabled ? "border-white/10 text-slate-400" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"}`}
                    >
                      {disabled ? t("aiSupport.aiSettings.variants.off") : t("aiSupport.aiSettings.variants.on")}
                    </button>
                    <button type="button" onClick={() => removeVariant(index)} aria-label={t("aiSupport.aiSettings.variants.remove")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-300/20 text-rose-200 hover:bg-rose-400/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    value={variant.title || ""}
                    onChange={(event) => patchVariant(index, { title: event.target.value })}
                    placeholder={t("aiSupport.aiSettings.variants.titlePlaceholder")}
                    dir="auto"
                    className="h-9 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white"
                  />
                  <textarea
                    value={variant.body || ""}
                    onChange={(event) => patchVariant(index, { body: event.target.value })}
                    placeholder={t("aiSupport.aiSettings.variants.bodyPlaceholder")}
                    dir="auto"
                    rows={6}
                    className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-6 text-white"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0b141a] p-3" dir="auto">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.aiSettings.variants.preview")}</div>
                  <div className="max-w-[420px] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[#005c4b] px-3 py-2 text-sm leading-6 text-white">
                    {previewTitle ? <div className="font-black">{previewTitle}</div> : null}
                    {previewTitle && previewBody ? <div className="h-2" /> : null}
                    {previewBody || <span className="text-white/50">{t("aiSupport.aiSettings.variants.previewEmpty")}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
