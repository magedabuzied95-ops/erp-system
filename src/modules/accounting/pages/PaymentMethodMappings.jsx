import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, CreditCard, Loader2, Plus, RefreshCcw, Settings2, Sparkles, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import { accountingApi } from "../services/accountingApi";

const paymentMethods = ["cash", "card", "bank_transfer", "vodafone_cash", "instapay", "wallet", "cod", "mixed"];
const emptyForm = {
  id: "",
  payment_method: "cash",
  branch_id: "",
  financial_account_id: "",
  is_default: true,
  is_active: true,
};
const inputClass = "w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70";

const label = (value) => String(value || "").replaceAll("_", " ");
const accountFits = (account, types) => account?.is_active !== false && types.includes(account?.account_type);

function PaymentMethodMappings() {
  const { t } = useTranslation();
  const [mappings, setMappings] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const [mappingResult, accountResult] = await Promise.all([
        accountingApi.getPaymentMethodMappings(),
        accountingApi.getFinancialAccounts({ include_inactive: true }),
      ]);
      setMappings(Array.isArray(mappingResult?.rows) ? mappingResult.rows : []);
      setAccounts(Array.isArray(accountResult?.rows) ? accountResult.rows : []);
    } catch (error) {
      toast.error(error?.message || t("accounting.paymentMappings.errors.loadFailed"));
      setMappings([]);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const missingDefaults = useMemo(
    () => paymentMethods.filter((method) => !mappings.some((mapping) => mapping.payment_method === method && mapping.is_active !== false && mapping.is_default && !mapping.branch_id)),
    [mappings]
  );

  const openCreate = () => {
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (mapping) => {
    setForm({
      id: mapping.id,
      payment_method: mapping.payment_method || "cash",
      branch_id: mapping.branch_id || "",
      financial_account_id: mapping.financial_account_id || "",
      is_default: mapping.is_default === true,
      is_active: mapping.is_active !== false,
    });
    setShowModal(true);
  };

  const saveMapping = async (event) => {
    event.preventDefault();
    if (!form.financial_account_id) {
      toast.error(t("accounting.paymentMappings.errors.chooseAccount"));
      return;
    }
    setSaving("mapping");
    try {
      const payload = { ...form, is_default: !form.branch_id && form.is_default };
      if (form.id) {
        await accountingApi.updatePaymentMethodMapping(form.id, payload);
      } else {
        await accountingApi.createPaymentMethodMapping(payload);
      }
      setShowModal(false);
      await load();
      toast.success(t("accounting.paymentMappings.toasts.saved"));
    } catch (error) {
      toast.error(error?.message || t("accounting.paymentMappings.errors.saveFailed"));
    } finally {
      setSaving("");
    }
  };

  const deleteMapping = async (mapping) => {
    setSaving(`delete-${mapping.id}`);
    try {
      await accountingApi.deletePaymentMethodMapping(mapping.id);
      await load();
      toast.success(t("accounting.paymentMappings.toasts.deleted"));
    } catch (error) {
      toast.error(error?.message || t("accounting.paymentMappings.errors.deleteFailed"));
    } finally {
      setSaving("");
    }
  };

  const quickSetup = async () => {
    const pick = (types) => accounts.find((account) => accountFits(account, types));
    const setup = [
      { payment_method: "cash", account: pick(["cash_drawer", "safe"]) },
      { payment_method: "card", account: pick(["card_settlement", "bank"]) },
      { payment_method: "instapay", account: pick(["wallet", "digital_wallet"]) },
      { payment_method: "vodafone_cash", account: pick(["wallet", "digital_wallet"]) },
    ];
    const missingAccount = setup.find((item) => !item.account);
    if (missingAccount) {
      toast.error(t("accounting.paymentMappings.errors.createAccountFirst", { method: label(missingAccount.payment_method) }));
      return;
    }
    setSaving("quick");
    try {
      await Promise.all(setup.map((item) => accountingApi.createPaymentMethodMapping({
        payment_method: item.payment_method,
        financial_account_id: item.account.id,
        branch_id: "",
        is_default: true,
        is_active: true,
      })));
      await load();
      toast.success(t("accounting.paymentMappings.toasts.quickSetup"));
    } catch (error) {
      toast.error(error?.message || t("accounting.paymentMappings.errors.quickSetupFailed"));
    } finally {
      setSaving("");
    }
  };

  return (
    <AccountingShell
      title={t("accounting.paymentMappings.title")}
      subtitle={t("accounting.paymentMappings.subtitle")}
      actions={
        <>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {t("accounting.common.actions.refresh")}
          </button>
          <button type="button" onClick={quickSetup} disabled={saving === "quick"} className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-black text-amber-100 transition hover:bg-amber-300/20 disabled:opacity-60">
            {saving === "quick" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t("accounting.paymentMappings.actions.quickSetup")}
          </button>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400">
            <Plus className="h-4 w-4" />
            {t("accounting.paymentMappings.actions.newMapping")}
          </button>
        </>
      }
      tabs={paymentMappingTabs(t)}
    >
      {missingDefaults.length ? (
        <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-black">{t("accounting.paymentMappings.missingDefaults")}</div>
              <div className="mt-1 text-amber-100/80">{missingDefaults.map(label).join(", ")}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h3 className="text-xl font-black text-white">{t("accounting.paymentMappings.mappingsTitle")}</h3>
            <p className="mt-1 text-sm text-zinc-500">{t("accounting.paymentMappings.mappingsSubtitle")}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-zinc-200">{t("accounting.paymentMappings.rulesCount", { count: mappings.length })}</div>
        </div>
        <div className="m1-table-container overflow-x-auto">
          <table className="m1-table m1-table--compact min-w-[920px] w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <Th>{t("accounting.paymentMappings.labels.paymentMethod")}</Th>
                <Th>{t("accounting.common.labels.branch")}</Th>
                <Th>{t("accounting.paymentMappings.labels.financialAccount")}</Th>
                <Th>{t("accounting.paymentMappings.labels.default")}</Th>
                <Th>{t("accounting.common.labels.active")}</Th>
                <Th align="right">{t("accounting.paymentMappings.labels.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {mappings.length ? mappings.map((mapping) => (
                <tr key={mapping.id} className="bg-zinc-950/80 text-zinc-300">
                  <Td className="font-black text-white">{label(mapping.payment_method)}</Td>
                  <Td>{mapping.branch_name || (mapping.branch_id ? t("accounting.financialAccounts.labels.branchNumber", { id: mapping.branch_id }) : t("accounting.paymentMappings.labels.tenantDefault"))}</Td>
                  <Td>
                    <div className="font-semibold text-white">{mapping.financial_account_name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{label(mapping.account_type)}</div>
                  </Td>
                  <Td><Pill active={mapping.is_default} label={mapping.is_default ? t("accounting.paymentMappings.labels.default") : t("accounting.paymentMappings.labels.override")} /></Td>
                  <Td><Pill active={mapping.is_active} label={mapping.is_active ? t("accounting.common.labels.active") : t("accounting.common.labels.inactive")} /></Td>
                  <Td align="right">
                    <div className="inline-flex items-center gap-2">
                      <button type="button" onClick={() => openEdit(mapping)} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-white transition hover:bg-white/10" title={t("accounting.common.actions.edit")}>
                        <Settings2 className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => deleteMapping(mapping)} disabled={saving === `delete-${mapping.id}`} className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-2 text-rose-100 transition hover:bg-rose-300/20 disabled:opacity-60" title={t("accounting.common.actions.delete")}>
                        {saving === `delete-${mapping.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </Td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-500">{t("accounting.paymentMappings.empty.noMappings")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal ? (
        <Modal title={form.id ? t("accounting.paymentMappings.modals.editTitle") : t("accounting.paymentMappings.modals.createTitle")} onClose={() => setShowModal(false)}>
          <form onSubmit={saveMapping} className="grid gap-4">
            <Field label={t("accounting.paymentMappings.labels.paymentMethod")}>
              <select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))} className={inputClass}>
                {paymentMethods.map((method) => <option key={method} value={method}>{label(method)}</option>)}
              </select>
            </Field>
            <Field label={t("accounting.common.labels.branchId")}>
              <input type="number" min="1" value={form.branch_id} onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value, is_default: event.target.value ? false : current.is_default }))} className={inputClass} placeholder={t("accounting.paymentMappings.placeholders.tenantDefault")} />
            </Field>
            <Field label={t("accounting.paymentMappings.labels.financialAccount")}>
              <select value={form.financial_account_id} onChange={(event) => setForm((current) => ({ ...current, financial_account_id: event.target.value }))} className={inputClass}>
                <option value="">{t("accounting.financialAccounts.placeholders.chooseAccount")}</option>
                {accounts.filter((account) => account.is_active !== false).map((account) => (
                  <option key={account.id} value={account.id}>{account.name} - {label(account.account_type)}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-200">
                <input type="checkbox" checked={!form.branch_id && form.is_default} disabled={Boolean(form.branch_id)} onChange={(event) => setForm((current) => ({ ...current, is_default: event.target.checked }))} />
                {t("accounting.paymentMappings.labels.tenantDefault")}
              </label>
              <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-200">
                <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
                {t("accounting.common.labels.active")}
              </label>
            </div>
            <button type="submit" disabled={saving === "mapping"} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black disabled:opacity-60">
              {saving === "mapping" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {t("accounting.paymentMappings.actions.saveMapping")}
            </button>
          </form>
        </Modal>
      ) : null}
    </AccountingShell>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function paymentMappingTabs(t) {
  return [
    { to: "/accounting", label: t("accounting.tabs.dashboard") },
    { to: "/accounting/financial-accounts", label: t("accounting.tabs.financialAccounts") },
    { to: "/accounting/payment-method-mappings", label: t("accounting.tabs.paymentMappings"), end: true },
    { to: "/accounting/cashbox", label: t("accounting.tabs.cashDrawer") },
    { to: "/accounting/reports", label: t("accounting.tabs.reports") },
    { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
  ];
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-xl font-black text-white">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-white transition hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Pill({ active, label }) {
  return (
    <span className={active ? "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-100" : "rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-black text-zinc-300"}>
      {label}
    </span>
  );
}

function Th({ children, align = "left" }) {
  return <th className={["px-4 py-3 font-black", align === "right" ? "text-right" : ""].join(" ")}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={["px-4 py-4 align-top", align === "right" ? "text-right" : "", className].join(" ")}>{children}</td>;
}

export default PaymentMethodMappings;
