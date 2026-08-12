import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Save, Settings2, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

import {
  createLoyaltyRule,
  getLoyaltyRules,
  updateLoyaltyRule,
} from "../loyaltyApi";
import { loyaltyMockData } from "../lib/loyaltyMockData";

const defaultForm = {
  name: "Default Loyalty Rule",
  points_per_currency_amount: 1,
  minimum_order_amount: 0,
  redeem_value: 1,
  bronze_threshold: 0,
  silver_threshold: 500,
  gold_threshold: 1500,
  platinum_threshold: 3000,
  is_active: true,
};

function LoyaltyRules() {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        const response = await getLoyaltyRules();
        if (!active) return;
        const nextRules = Array.isArray(response?.rules) && response.rules.length ? response.rules : loyaltyMockData.rules;
        setRules(nextRules);
        setSelectedId(nextRules[0]?.id || null);
        setForm(nextRules[0] || defaultForm);
      } catch (error) {
        if (!active) return;
        console.log(error);
        setRules(loyaltyMockData.rules);
        setSelectedId(loyaltyMockData.rules[0]?.id || null);
        setForm(loyaltyMockData.rules[0] || defaultForm);
        toast.error(t("loyalty.rules.fallbackToast"));
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedId) || rules[0] || null, [rules, selectedId]);

  const handleChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveRule = async () => {
    try {
      setSaving(true);
      const payload = {
        ...form,
        points_per_currency_amount: Number(form.points_per_currency_amount),
        minimum_order_amount: Number(form.minimum_order_amount),
        redeem_value: Number(form.redeem_value),
        bronze_threshold: Number(form.bronze_threshold),
        silver_threshold: Number(form.silver_threshold),
        gold_threshold: Number(form.gold_threshold),
        platinum_threshold: Number(form.platinum_threshold),
        is_active: Boolean(form.is_active),
      };

      let nextRule;
      if (selectedRule?.id) {
        const response = await updateLoyaltyRule(selectedRule.id, payload);
        nextRule = response.rule;
        toast.success(t("loyalty.rules.updated"));
      } else {
        const response = await createLoyaltyRule(payload);
        nextRule = response.rule;
        toast.success(t("loyalty.rules.created"));
      }

      setRules((current) => {
        const exists = current.some((rule) => rule.id === nextRule.id);
        return exists ? current.map((rule) => (rule.id === nextRule.id ? nextRule : rule)) : [nextRule, ...current];
      });
      setSelectedId(nextRule.id);
      setForm(nextRule);
    } catch (error) {
      console.log(error);
      toast.error(error.message || "Failed to save loyalty rule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-[var(--text)]">
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-6">
        <p className="text-xs uppercase tracking-[0.3em] text-primary/80">{t("loyalty.rules.eyebrow")}</p>
        <h1 className="m1-page-title mt-2">{t("loyalty.rules.title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          {t("loyalty.rules.subtitle")}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="m1-section-title">{t("loyalty.rules.existing")}</h2>
          </div>
          <div className="mt-4 space-y-3">
            {(loading ? [] : rules).map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => {
                  setSelectedId(rule.id);
                  setForm(rule);
                }}
                className={`w-full rounded-[var(--radius-control)] border px-4 py-3 text-left transition ${ selectedId === rule.id ? "border-primary/40 bg-primary/10" : "border-[var(--border)] bg-[var(--surface)] hover:border-primary/20" }`}
              >
                <p className="font-semibold text-[var(--text)]">{rule.name}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {Number(rule.points_per_currency_amount || 0)} points / currency unit
                </p>
              </button>
            ))}
            {!loading && rules.length === 0 ? <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-5 text-sm text-[var(--muted)]">{t("loyalty.rules.none")}</div> : null}
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            <h2 className="m1-section-title">{t("loyalty.rules.editor")}</h2>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {[
              ["name", t("loyalty.rules.fields.name"), "text"],
              ["points_per_currency_amount", t("loyalty.rules.fields.pointsPerCurrency"), "number"],
              ["minimum_order_amount", t("loyalty.rules.fields.minimumOrder"), "number"],
              ["redeem_value", t("loyalty.rules.fields.redeemValue"), "number"],
              ["bronze_threshold", t("loyalty.rules.fields.bronze"), "number"],
              ["silver_threshold", t("loyalty.rules.fields.silver"), "number"],
              ["gold_threshold", t("loyalty.rules.fields.gold"), "number"],
              ["platinum_threshold", t("loyalty.rules.fields.platinum"), "number"],
            ].map(([field, label, type]) => (
              <label key={field} className="space-y-2 text-sm text-[var(--muted)]">
                <span className="block text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{label}</span>
                <input
                  type={type}
                  value={form[field] ?? ""}
                  onChange={(e) => handleChange(field, type === "number" ? e.target.value : e.target.value)}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--text)] outline-none ring-0 focus:border-primary/40"
                />
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div>
              <p className="font-semibold text-[var(--text)]">{t("loyalty.rules.active")}</p>
              <p className="text-xs text-[var(--muted)]">{t("loyalty.rules.inactiveHint")}</p>
            </div>
            <button
              type="button"
              onClick={() => handleChange("is_active", !form.is_active)}
              className={`rounded-full px-4 py-2 text-sm font-bold ${form.is_active ? "bg-emerald-500/15 text-emerald-300" : "bg-[var(--card)] text-[var(--muted)]"}`}
            >
              {form.is_active ? "Enabled" : "Disabled"}
            </button>
          </div>

          <button
            type="button"
            onClick={saveRule}
            disabled={saving}
            className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? t("loyalty.rules.saving") : selectedRule?.id ? t("loyalty.rules.update") : t("loyalty.rules.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoyaltyRules;
