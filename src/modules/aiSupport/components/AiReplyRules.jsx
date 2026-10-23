import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../shared/api/api";
import { AI_REPLY_RULE_DEFAULTS } from "../../../../shared/aiReplyRules.js";

const labels = {
  ai_rules_grade_question: ["السؤال عن درجة المنتج", "لو الموديل له أكتر من درجة، العميل يختار الدرجة قبل عرض الكروت."],
  ai_rules_booking_question: ["سؤال الحجز تحت الكروت", "العميل يشوف «تحب أحجزهولك؟» تحت كروت المنتجات."],
  ai_rules_product_link: ["رابط المنتج تحت الكروت", "العميل يشوف «شوفه من هنا» ورابط المنتج مع الكروت."],
};

export default function AiReplyRules({ headers, tenantId }) {
  const { t } = useTranslation("translation");
  const [rules, setRules] = useState(AI_REPLY_RULE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setStatus("");
    api.get(`/ai-agent/settings/rules?tenant_id=${encodeURIComponent(tenantId)}`, { headers }).then((result) => {
      if (active) setRules(result.rules);
    }).catch(() => { if (active) setStatus("loadError"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [headers, tenantId]);
  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const result = await api.put("/ai-agent/settings/rules", { tenant_id: tenantId, rules }, { headers });
      setRules(result.rules);
      setStatus("saved");
    } catch { setStatus("saveError"); }
    finally { setSaving(false); }
  };
  const statusText = { saved: "تم حفظ القواعد لهذا المتجر", loadError: "تعذر تحميل القواعد. أعد تحميل الصفحة.", saveError: "تعذر حفظ القواعد. حاول مرة أخرى." };
  return <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.055] p-4" aria-labelledby="ai-rules-title">
    <h2 id="ai-rules-title" className="text-lg font-black text-white">{t("aiRules.title", { defaultValue: "قواعد الـ AI" })}</h2>
    <p className="mt-1 text-sm leading-6 text-slate-400">{t("aiRules.hint", { defaultValue: "طريقة رد الذكاء على عملاء هذا المتجر في واتساب وماسنجر وإنستجرام." })}</p>
    <fieldset disabled={loading || saving || status === "loadError"} className="mt-4 min-w-0 space-y-3 disabled:opacity-60">
      {Object.entries(labels).map(([key, [label, hint]]) => <label key={key} className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
        <span className="min-w-0"><span className="block text-sm font-bold text-white">{t(`aiRules.${key}.label`, { defaultValue: label })}</span><span className="mt-1 block text-xs leading-6 text-slate-400">{t(`aiRules.${key}.hint`, { defaultValue: hint })}</span></span>
        <input type="checkbox" role="switch" checked={rules[key]} onChange={(event) => setRules({ ...rules, [key]: event.target.checked })} className="h-5 w-5 shrink-0 accent-emerald-400" />
      </label>)}
      <label className="block text-sm font-bold text-white">{t("aiRules.intro", { defaultValue: "السطر فوق كروت المنتجات" })}
        <span className="my-2 block text-xs font-normal leading-6 text-slate-400">{t("aiRules.introHint", { defaultValue: "العميل يشوف النص ده فوق كروت المنتجات المتاحة." })}</span>
        <textarea maxLength={300} value={rules.ai_rules_cards_intro} onChange={(event) => setRules({ ...rules, ai_rules_cards_intro: event.target.value })} className="w-full min-w-0 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-white" rows={2} />
      </label>
      <button type="button" disabled={!rules.ai_rules_cards_intro.trim()} onClick={save} className="min-h-11 rounded-xl bg-primary px-4 font-bold text-white disabled:opacity-50">{t("aiRules.save", { defaultValue: saving ? "جاري الحفظ…" : "حفظ قواعد الـ AI" })}</button>
    </fieldset>
    {status && <p role="status" className="mt-3 text-sm text-slate-200">{t(`aiRules.${status}`, { defaultValue: statusText[status] })}</p>}
  </section>;
}
