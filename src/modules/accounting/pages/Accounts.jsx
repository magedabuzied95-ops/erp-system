import { useMemo } from "react";
import { Link } from "react-router-dom";

import { BookUser, Building2, Landmark, Wallet } from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import {
  buildCashLedger,
  buildCustomerLedger,
  buildSupplierLedger,
  formatCurrency,
  formatDateTime,
  getAccountingSources,
} from "../lib/financeStore";

function Accounts() {
  const sources = useMemo(() => getAccountingSources(), []);
  const customerLedger = useMemo(() => buildCustomerLedger(sources.orders), [sources.orders]);
  const supplierLedger = useMemo(() => buildSupplierLedger(sources.purchases), [sources.purchases]);
  const cashLedger = useMemo(() => buildCashLedger(sources.cashMovements), [sources.cashMovements]);

  const customerBalance = customerLedger.reduce((sum, row) => sum + Number(row.runningBalance || 0), 0);
  const supplierBalance = supplierLedger.reduce((sum, row) => sum + Number(row.runningBalance || 0), 0);
  const cashBalance = cashLedger.length ? cashLedger[cashLedger.length - 1].runningBalance : 0;
  const customers = new Set(sources.orders.map((order) => order.customer_name || "Walk-in Customer")).size;

  return (
    <AccountingShell
      title="Ledgers"
      subtitle="Customer ledger, supplier ledger, cash ledger, transaction history, and running balances across the accounting modules."
      actions={
        <Link to="/accounting/reports" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
          <Landmark className="h-4 w-4" />
          Financial reports
        </Link>
      }
      tabs={[
        { to: "/accounting", label: "Dashboard" },
        { to: "/accounting/ledgers", label: "Ledgers", end: true },
        { to: "/accounting/reports", label: "Reports" },
        { to: "/accounting/profit-loss", label: "P&L" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label="Customers" value={customers} tone="cyan" icon={<BookUser className="h-5 w-5" />} />
        <FinanceMetricCard label="Customer ledger" value={formatCurrency(customerBalance)} tone="emerald" icon={<BookUser className="h-5 w-5" />} />
        <FinanceMetricCard label="Supplier ledger" value={formatCurrency(supplierBalance)} tone="rose" icon={<Building2 className="h-5 w-5" />} />
        <FinanceMetricCard label="Cash ledger" value={formatCurrency(cashBalance)} tone="amber" icon={<Wallet className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <LedgerPanel title="Customer ledger" rows={customerLedger.slice(0, 8)} />
        <LedgerPanel title="Supplier ledger" rows={supplierLedger.slice(0, 8)} />
        <LedgerPanel title="Cash ledger" rows={cashLedger.slice(0, 8)} />
      </div>
    </AccountingShell>
  );
}

function LedgerPanel({ title, rows }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <h3 className="text-xl font-black text-white">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">No ledger rows.</div>
        ) : (
          rows.map((row, index) => (
            <div key={`${row.id || title}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{row.account || row.customer_name || row.supplier_name || row.note || "Ledger row"}</div>
                  <div className="mt-1 text-xs text-zinc-500">{formatDateTime(row.created_at)}</div>
                </div>
                <div className="text-right">
                  <div className="font-black text-white">{formatCurrency(row.debit || row.credit || row.amount || 0)}</div>
                  <div className="text-xs text-zinc-500">Balance {formatCurrency(row.runningBalance || 0)}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Accounts;
