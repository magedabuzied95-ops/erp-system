import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../shared/api/api";
import { IS_WHOLESALE_APP } from "../../../shared/constants/app";

// Wholesale copy only: the customer is a wholesale or half-wholesale buyer (which piece
// price the invoice uses), with a credit limit and payment terms.

const EMPTY = { tier: "wholesale", credit_limit: "0", due_days: "0" };

export function useWholesaleCustomerTerms() {
  const [value, setValue] = useState(EMPTY);

  const load = useCallback((customerId) => {
    setValue(EMPTY);
    if (!IS_WHOLESALE_APP || !customerId) return;
    api.get(`/wholesale/customers/${customerId}/terms`)
      .then((res) => setValue({
        tier: res?.data?.tier || "wholesale",
        credit_limit: String(res?.data?.credit_limit ?? 0),
        due_days: String(res?.data?.due_days ?? 0),
      }))
      .catch(() => {});
  }, []);

  const reset = useCallback(() => setValue(EMPTY), []);

  const save = useCallback(async (customerId) => {
    if (!IS_WHOLESALE_APP || !customerId) return null;
    return api.put(`/wholesale/customers/${customerId}/terms`, {
      tier: value.tier,
      credit_limit: Number(value.credit_limit) || 0,
      due_days: Number(value.due_days) || 0,
    });
  }, [value]);

  return { enabled: IS_WHOLESALE_APP, value, setValue, load, reset, save };
}

export default function WholesaleCustomerTerms({ value, onChange, inputClass = "" }) {
  const { t } = useTranslation();
  if (!IS_WHOLESALE_APP) return null;
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="mt-4 rounded-[var(--radius-card)] border border-primary/20 bg-primary/10 px-4 py-3">
      <span className="block text-sm font-black text-text">{t("orders.wholesale.customer.title")}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {["wholesale", "half_wholesale"].map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => set({ tier })}
            className={`rounded-full border px-4 py-1.5 text-sm font-black ${value.tier === tier ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface text-text"}`}
          >
            {t(`orders.wholesale.tiers.${tier}`)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-bold text-text-muted">
          {t("orders.wholesale.customer.creditLimit")}
          <input className={inputClass} inputMode="decimal" value={value.credit_limit} onChange={(e) => set({ credit_limit: e.target.value.replace(/[^\d.]/g, "") })} />
          <span className="text-[11px]">{t("orders.wholesale.customer.noLimit")}</span>
        </label>
        <label className="grid gap-1 text-xs font-bold text-text-muted">
          {t("orders.wholesale.customer.dueDays")}
          <input className={inputClass} inputMode="numeric" value={value.due_days} onChange={(e) => set({ due_days: e.target.value.replace(/[^\d]/g, "") })} />
        </label>
      </div>
    </div>
  );
}
