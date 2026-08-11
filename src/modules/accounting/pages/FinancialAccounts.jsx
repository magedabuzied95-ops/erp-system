import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ArrowRightLeft, Building2, CreditCard, Landmark, Loader2, Plus, RefreshCcw, Wallet, X } from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import { formatCurrency, formatDateTime } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";
import { getCurrency } from "../../../shared/lib/currency";

const accountTypes = [
  "cash_drawer",
  "safe",
  "bank",
  "wallet",
  "digital_wallet",
  "card_settlement",
];

const emptyAccountForm = {
  id: "",
  name: "",
  account_type: "cash_drawer",
  currency: "",
  branch_id: "",
  opening_balance: "",
  allow_negative_balance: false,
  notes: "",
  is_active: true,
};

const emptyTransferForm = { from_account_id: "", to_account_id: "", amount: "", notes: "" };
const inputClass = "w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70";

const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const labelForType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "cash_drawer") return "درج النقدية";
  if (normalized === "safe") return "خزنة";
  if (normalized === "bank") return "بنك";
  if (normalized === "wallet") return "محفظة";
  if (normalized === "digital_wallet") return "محفظة رقمية";
  if (normalized === "card_settlement") return "تسويات البطاقات";
  if (normalized === "ledger") return "دفتر";
  if (normalized === "cash") return "نقدية";
  return "غير معروف";
};

function FinancialAccounts() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [filters, setFilters] = useState({ account_type: "", branch_id: "" });
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [transferForm, setTransferForm] = useState(emptyTransferForm);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");

  const load = async (params = filters) => {
    setLoading(true);
    try {
      const [accountResult, transferResult] = await Promise.all([
        accountingApi.getFinancialAccounts({ ...params, include_inactive: true }),
        accountingApi.getFinancialAccountTransfers(),
      ]);
      const nextAccounts = Array.isArray(accountResult?.rows) ? accountResult.rows : [];
      setAccounts(nextAccounts);
      setTransfers(Array.isArray(transferResult?.rows) ? transferResult.rows : []);
      if (selectedAccount) {
        const refreshed = nextAccounts.find((item) => item.id === selectedAccount.id) || null;
        setSelectedAccount(refreshed);
        if (refreshed) loadEntries(refreshed);
      }
    } catch (error) {
      toast.error(error?.message || t("accounting.financialAccounts.errors.loadFailed"));
      setAccounts([]);
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadEntries = async (account) => {
    if (!account?.id) return;
    try {
      const result = await accountingApi.getFinancialAccountEntries(account.id);
      setEntries(Array.isArray(result?.rows) ? result.rows : []);
    } catch (error) {
      toast.error(error?.message || t("accounting.financialAccounts.errors.historyFailed"));
      setEntries([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(
    () => accounts.reduce((acc, account) => acc + money(account.current_balance), 0),
    [accounts]
  );

  const openCreateModal = () => {
    setAccountForm({ ...emptyAccountForm, currency: getCurrency().code });
    setShowAccountModal(true);
  };

  const openEditModal = (account) => {
    setAccountForm({
      id: account.id,
      name: account.name || "",
      account_type: account.account_type || "cash_drawer",
      currency: account.currency || getCurrency().code,
      branch_id: account.branch_id || "",
      opening_balance: account.opening_balance || "",
      allow_negative_balance: account.allow_negative_balance === true,
      notes: account.notes || "",
      is_active: account.is_active !== false,
    });
    setShowAccountModal(true);
  };

  const saveAccount = async (event) => {
    event.preventDefault();
    if (!accountForm.name.trim()) {
      toast.error(t("accounting.financialAccounts.errors.nameRequired"));
      return;
    }
    setSaving("account");
    try {
      if (accountForm.id) {
        await accountingApi.updateFinancialAccount(accountForm.id, accountForm);
      } else {
        await accountingApi.createFinancialAccount(accountForm);
      }
      setShowAccountModal(false);
      await load(filters);
      toast.success(t("accounting.financialAccounts.toasts.saved"));
    } catch (error) {
      toast.error(error?.message || t("accounting.financialAccounts.errors.saveFailed"));
    } finally {
      setSaving("");
    }
  };

  const submitTransfer = async (event) => {
    event.preventDefault();
    if (!transferForm.from_account_id || !transferForm.to_account_id || money(transferForm.amount) <= 0) {
      toast.error(t("accounting.financialAccounts.errors.transferRequired"));
      return;
    }
    setSaving("transfer");
    try {
      await accountingApi.transferFinancialAccounts(transferForm);
      setShowTransferModal(false);
      setTransferForm(emptyTransferForm);
      await load(filters);
      toast.success(t("accounting.financialAccounts.toasts.transferPosted"));
    } catch (error) {
      toast.error(error?.message || t("accounting.financialAccounts.errors.transferFailed"));
    } finally {
      setSaving("");
    }
  };

  const selectAccount = async (account) => {
    setSelectedAccount(account);
    await loadEntries(account);
  };

  const applyFilters = (event) => {
    event.preventDefault();
    load(filters);
  };

  return (
    <AccountingShell
      title={t("accounting.financialAccounts.title")}
      subtitle={t("accounting.financialAccounts.subtitle")}
      actions={
        <>
          <button type="button" onClick={() => load(filters)} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {t("accounting.common.actions.refresh")}
          </button>
          <button type="button" onClick={() => setShowTransferModal(true)} className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-black text-amber-100 transition hover:bg-amber-300/20">
            <ArrowRightLeft className="h-4 w-4" />
            {t("accounting.financialAccounts.actions.transfer")}
          </button>
          <button type="button" onClick={openCreateModal} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400">
            <Plus className="h-4 w-4" />
            {t("accounting.financialAccounts.actions.newAccount")}
          </button>
        </>
      }
      tabs={[
        { to: "/accounting", label: t("accounting.tabs.dashboard") },
        { to: "/accounting/financial-accounts", label: t("accounting.tabs.financialAccounts"), end: true },
        { to: "/accounting/payment-method-mappings", label: t("accounting.tabs.paymentMappings") },
        { to: "/accounting/cashbox", label: t("accounting.tabs.cashDrawer") },
        { to: "/accounting/reports", label: t("accounting.tabs.reports") },
        { to: "/accounting/ledgers", label: t("accounting.tabs.ledgers") },
        { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
      ]}
    >
      <form onSubmit={applyFilters} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10 md:grid-cols-3">
        <Field label={t("accounting.common.labels.accountType")}>
          <select value={filters.account_type} onChange={(event) => setFilters((current) => ({ ...current, account_type: event.target.value }))} className={inputClass}>
            <option value="">{t("accounting.financialAccounts.filters.allTypes")}</option>
            {accountTypes.map((type) => <option key={type} value={type}>{t(`accounting.accountTypes.${type}`)}</option>)}
          </select>
        </Field>
        <Field label={t("accounting.common.labels.branchId")}>
          <input type="number" min="1" value={filters.branch_id} onChange={(event) => setFilters((current) => ({ ...current, branch_id: event.target.value }))} className={inputClass} placeholder={t("accounting.financialAccounts.filters.anyBranch")} />
        </Field>
        <div className="flex items-end">
          <button type="submit" className="w-full rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black">{t("accounting.common.actions.apply")}</button>
        </div>
      </form>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label={t("accounting.financialAccounts.metrics.accounts")} value={accounts.length} />
        <Metric label={t("accounting.financialAccounts.metrics.combinedBalance")} value={formatCurrency(totals)} />
        <Metric label={t("accounting.financialAccounts.metrics.transfers")} value={transfers.length} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {accounts.length ? accounts.map((account) => (
            <button key={account.id} type="button" onClick={() => selectAccount(account)} className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 text-left shadow-2xl shadow-black/10 transition hover:border-cyan-300/40 hover:bg-white/[0.03]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-white">{account.name}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{t(`accounting.accountTypes.${account.account_type}`, { defaultValue: labelForType(account.account_type) })}</div>
                </div>
                <AccountIcon type={account.account_type} />
              </div>
              <div className={money(account.current_balance) < 0 ? "mt-5 text-3xl font-black text-rose-300" : "mt-5 text-3xl font-black text-white"}>
                {formatCurrency(account.current_balance)}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span>{account.branch_name || (account.branch_id ? t("accounting.financialAccounts.labels.branchNumber", { id: account.branch_id }) : t("accounting.financialAccounts.labels.allBranches"))}</span>
                <span>{account.currency}</span>
              </div>
              {money(account.current_balance) < 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs font-semibold text-rose-100">
                  <AlertTriangle className="h-4 w-4" />
                  {t("accounting.financialAccounts.labels.negativeBalance")}
                </div>
              ) : null}
              <button type="button" onClick={(event) => { event.stopPropagation(); openEditModal(account); }} className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white transition hover:bg-white/10">
                {t("accounting.common.actions.edit")}
              </button>
            </button>
          )) : (
            <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/90 p-8 text-sm text-zinc-400 md:col-span-2">
              {t("accounting.financialAccounts.empty.noAccounts")}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="text-xl font-black text-white">{t("accounting.financialAccounts.history.title")}</h3>
          <p className="mt-1 text-sm text-zinc-500">{selectedAccount ? selectedAccount.name : t("accounting.financialAccounts.history.selectAccount")}</p>
          <div className="mt-4 max-h-[560px] space-y-3 overflow-auto pr-1">
            {entries.length ? entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{labelForType(entry.entry_type)}</div>
                    <div className="mt-1 text-xs text-zinc-500">{translateSourceType(entry.source_type || "manual")} {entry.source_id ? `#${entry.source_id}` : ""}</div>
                    <div className="mt-1 text-xs text-zinc-500">{formatDateTime(entry.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className={money(entry.amount) < 0 ? "font-black text-rose-300" : "font-black text-emerald-300"}>{formatCurrency(entry.amount)}</div>
                    <div className="mt-1 text-xs text-zinc-500">{t("accounting.financialAccounts.labels.balanceShort")} {formatCurrency(entry.balance_after)}</div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
                {t("accounting.financialAccounts.empty.noTransactions")}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/20">
        <div className="border-b border-white/10 p-4">
          <h3 className="text-xl font-black text-white">{t("accounting.financialAccounts.transfers.title")}</h3>
        </div>
        <div className="m1-table-container overflow-x-auto">
          <table className="m1-table m1-table--compact min-w-[820px] w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <Th>{t("accounting.common.labels.from")}</Th>
                <Th>{t("accounting.common.labels.to")}</Th>
                <Th align="right">{t("accounting.common.labels.amount")}</Th>
                <Th>{t("accounting.common.labels.notes")}</Th>
                <Th>{t("accounting.common.labels.created")}</Th>
              </tr>
            </thead>
            <tbody>
              {transfers.length ? transfers.map((transfer) => (
                <tr key={transfer.id} className="bg-zinc-950/80 text-zinc-300">
                  <Td className="font-semibold text-white">{transfer.from_account_name}</Td>
                  <Td className="font-semibold text-white">{transfer.to_account_name}</Td>
                  <Td align="right" className="font-black text-white">{formatCurrency(transfer.amount)}</Td>
                  <Td>{transfer.notes || "-"}</Td>
                  <Td>{formatDateTime(transfer.created_at)}</Td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">{t("accounting.financialAccounts.empty.noTransfers")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAccountModal ? (
        <Modal title={accountForm.id ? t("accounting.financialAccounts.modals.editTitle") : t("accounting.financialAccounts.modals.createTitle")} onClose={() => setShowAccountModal(false)}>
          <form onSubmit={saveAccount} className="grid gap-4">
            <Field label={t("accounting.common.labels.name")}><input value={accountForm.name} onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} autoFocus /></Field>
            <Field label={t("accounting.common.labels.type")}>
              <select value={accountForm.account_type} onChange={(event) => setAccountForm((current) => ({ ...current, account_type: event.target.value }))} className={inputClass}>
                {accountTypes.map((type) => <option key={type} value={type}>{t(`accounting.accountTypes.${type}`)}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("accounting.common.labels.currency")}><input value={accountForm.currency} onChange={(event) => setAccountForm((current) => ({ ...current, currency: event.target.value }))} className={inputClass} /></Field>
              <Field label={t("accounting.common.labels.branchId")}><input type="number" min="1" value={accountForm.branch_id} onChange={(event) => setAccountForm((current) => ({ ...current, branch_id: event.target.value }))} className={inputClass} /></Field>
              <Field label={t("accounting.common.labels.opening")}><input type="number" min="0" step="0.01" value={accountForm.opening_balance} onChange={(event) => setAccountForm((current) => ({ ...current, opening_balance: event.target.value }))} disabled={Boolean(accountForm.id)} className={inputClass} /></Field>
            </div>
            <Field label={t("accounting.common.labels.notes")}><textarea value={accountForm.notes} onChange={(event) => setAccountForm((current) => ({ ...current, notes: event.target.value }))} className={`${inputClass} min-h-24`} /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <input type="checkbox" checked={accountForm.is_active} onChange={(event) => setAccountForm((current) => ({ ...current, is_active: event.target.checked }))} />
              {t("accounting.common.labels.active")}
            </label>
            <label className="flex items-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100">
              <input type="checkbox" checked={accountForm.allow_negative_balance} onChange={(event) => setAccountForm((current) => ({ ...current, allow_negative_balance: event.target.checked }))} />
              السماح برصيد سالب
            </label>
            <button type="submit" disabled={saving === "account"} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black disabled:opacity-60">
              {saving === "account" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("accounting.financialAccounts.actions.saveAccount")}
            </button>
          </form>
        </Modal>
      ) : null}

      {showTransferModal ? (
        <Modal title={t("accounting.financialAccounts.modals.transferTitle")} onClose={() => setShowTransferModal(false)}>
          <form onSubmit={submitTransfer} className="grid gap-4">
            <Field label={t("accounting.common.labels.from")}><AccountSelect accounts={accounts} value={transferForm.from_account_id} onChange={(value) => setTransferForm((current) => ({ ...current, from_account_id: value }))} placeholder={t("accounting.financialAccounts.placeholders.chooseAccount")} /></Field>
            <Field label={t("accounting.common.labels.to")}><AccountSelect accounts={accounts} value={transferForm.to_account_id} onChange={(value) => setTransferForm((current) => ({ ...current, to_account_id: value }))} placeholder={t("accounting.financialAccounts.placeholders.chooseAccount")} /></Field>
            <Field label={t("accounting.common.labels.amount")}><input type="number" min="0" step="0.01" value={transferForm.amount} onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))} className={inputClass} /></Field>
            <Field label={t("accounting.common.labels.notes")}><textarea value={transferForm.notes} onChange={(event) => setTransferForm((current) => ({ ...current, notes: event.target.value }))} className={`${inputClass} min-h-24`} /></Field>
            <button type="submit" disabled={saving === "transfer"} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-black disabled:opacity-60">
              {saving === "transfer" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              {t("accounting.financialAccounts.actions.postTransfer")}
            </button>
          </form>
        </Modal>
      ) : null}
    </AccountingShell>
  );
}

function AccountSelect({ accounts, value, onChange, placeholder }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
      <option value="">{placeholder}</option>
      {accounts.filter((account) => account.is_active !== false).map((account) => (
        <option key={account.id} value={account.id}>{account.name} - {formatCurrency(account.current_balance)}</option>
      ))}
    </select>
  );
}

function translateSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "sale") return "بيع";
  if (normalized === "purchase") return "شراء";
  if (normalized === "return") return "مرتجع";
  if (normalized === "manual") return "يدوي";
  if (normalized === "expense") return "مصروف";
  if (normalized === "inventory") return "مخزون";
  if (normalized === "payment") return "سداد";
  if (normalized === "transfer") return "تحويل";
  if (normalized === "journal") return "قيد يومي";
  return "غير معروف";
}

function AccountIcon({ type }) {
  const className = "h-5 w-5 text-cyan-300";
  if (type === "bank" || type === "card_settlement") return <Landmark className={className} />;
  if (type === "wallet" || type === "digital_wallet") return <Wallet className={className} />;
  if (type === "safe") return <Building2 className={className} />;
  return <CreditCard className={className} />;
}

function Metric({ label, value }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
    </div>
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

function Th({ children, align = "left" }) {
  return <th className={["px-4 py-3 font-black", align === "right" ? "text-right" : ""].join(" ")}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={["px-4 py-4 align-top", align === "right" ? "text-right" : "", className].join(" ")}>{children}</td>;
}

export default FinancialAccounts;
