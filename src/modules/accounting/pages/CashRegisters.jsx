import { useMemo, useState } from "react";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  DoorOpen,
  MoveRight,
  Plus,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import {
  buildCashLedger,
  formatCurrency,
  formatDateTime,
  generateCode,
  getCashMovements,
  getCashShifts,
  saveCashMovements,
  saveCashShifts,
  seedCashMovements,
  seedCashShifts,
} from "../lib/financeStore";

function CashRegisters() {
  const [cashShifts, setCashShifts] = useState(getCashShifts());
  const [cashMovements, setCashMovements] = useState(getCashMovements());
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [type, setType] = useState("Cash in");

  const activeShift = useMemo(() => cashShifts.find((shift) => shift.status === "Open") || null, [cashShifts]);
  const ledger = useMemo(() => buildCashLedger(cashMovements), [cashMovements]);
  const dailyBalance = ledger.length ? ledger[ledger.length - 1].runningBalance : activeShift?.opening_balance || 0;
  const cashIn = cashMovements.filter((movement) => movement.type === "Cash in").reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const cashOut = cashMovements.filter((movement) => movement.type === "Cash out").reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

  const sync = (nextMovements, nextShifts) => {
    setCashMovements(nextMovements);
    setCashShifts(nextShifts);
    saveCashMovements(nextMovements);
    saveCashShifts(nextShifts);
  };

  const openShift = () => {
    const nextShift = {
      id: `shift-${Date.now()}`,
      status: "Open",
      opened_by: "Cashier",
      opened_at: new Date().toISOString(),
      opening_balance: 3000,
      expected_balance: 3000,
      counted_balance: null,
    };
    const nextShifts = [nextShift, ...cashShifts.map((shift) => ({ ...shift, status: "Closed" }))];
    sync(cashMovements.length ? cashMovements : seedCashMovements(), nextShifts);
    toast.success("Shift opened");
  };

  const closeShift = () => {
    if (!activeShift) {
      toast.error("No open shift");
      return;
    }
    const nextShifts = cashShifts.map((shift) =>
      shift.id === activeShift.id
        ? { ...shift, status: "Closed", closed_at: new Date().toISOString(), counted_balance: dailyBalance }
        : shift
    );
    sync(cashMovements, nextShifts);
    toast.success("Shift closed");
  };

  const submitMovement = async () => {
    if (!Number(amount)) {
      toast.error("Amount is required");
      return;
    }

    const movement = {
      id: generateCode("CASH"),
      type,
      amount: Number(amount),
      note,
      created_at: new Date().toISOString(),
    };

    const nextMovements = [movement, ...cashMovements];
    sync(nextMovements, cashShifts.length ? cashShifts : seedCashShifts());
    setNote("");
    setAmount(0);
    toast.success("Cash movement recorded locally");
  };

  return (
    <AccountingShell
      title="Cashbox / Treasury"
      subtitle="Open and close shifts, record cash in and cash out, track daily balances, and keep a shift summary even when treasury endpoints are unavailable."
      actions={
        <>
          <button type="button" onClick={openShift} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black">
            <DoorOpen className="h-4 w-4" />
            Open shift
          </button>
          <button type="button" onClick={closeShift} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Wallet className="h-4 w-4" />
            Close shift
          </button>
        </>
      }
      tabs={[
        { to: "/accounting", label: "Dashboard" },
        { to: "/accounting/cashbox", label: "Cashbox", end: true },
        { to: "/accounting/expenses", label: "Expenses" },
        { to: "/accounting/income", label: "Income" },
        { to: "/accounting/journal-entries", label: "Journal" },
        { to: "/accounting/ledgers", label: "Ledgers" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label="Daily balance" value={formatCurrency(dailyBalance)} tone="emerald" icon={<Banknote className="h-5 w-5" />} />
        <FinanceMetricCard label="Cash in" value={formatCurrency(cashIn)} tone="cyan" icon={<ArrowDownLeft className="h-5 w-5" />} />
        <FinanceMetricCard label="Cash out" value={formatCurrency(cashOut)} tone="rose" icon={<ArrowUpRight className="h-5 w-5" />} />
        <FinanceMetricCard label="Open shift" value={activeShift ? "Yes" : "No"} tone="amber" icon={<MoveRight className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="text-xl font-black text-white">Cash movement</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Movement type" type="select" value={type} onChange={setType} options={["Cash in", "Cash out"]} />
            <Field label="Amount" type="number" value={amount} onChange={setAmount} />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Note</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none" placeholder="Reason, voucher, cash count note..." />
          </label>
          <button type="button" onClick={submitMovement} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black">
            <Plus className="h-4 w-4" />
            Add cash movement
          </button>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Shift summary</div>
            <div className="mt-3 space-y-2 text-sm text-zinc-300">
              <div className="flex items-center justify-between"><span>Active shift</span><span className="font-semibold text-white">{activeShift ? activeShift.status : "Closed"}</span></div>
              <div className="flex items-center justify-between"><span>Opened at</span><span className="font-semibold text-white">{activeShift ? formatDateTime(activeShift.opened_at) : "n/a"}</span></div>
              <div className="flex items-center justify-between"><span>Opening balance</span><span className="font-semibold text-white">{activeShift ? formatCurrency(activeShift.opening_balance) : formatCurrency(0)}</span></div>
              <div className="flex items-center justify-between"><span>Expected balance</span><span className="font-semibold text-white">{activeShift ? formatCurrency(activeShift.expected_balance) : formatCurrency(dailyBalance)}</span></div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="text-xl font-black text-white">Cash movements history</h3>
          <div className="mt-4 space-y-3">
            {ledger.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">No cash movements recorded yet.</div>
            ) : (
              ledger.map((movement) => (
                <div key={movement.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{movement.type}</div>
                      <div className="mt-1 text-xs text-zinc-500">{movement.note || "No note"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-white">{formatCurrency(movement.amount)}</div>
                      <div className="text-xs text-zinc-500">{formatDateTime(movement.created_at)}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AccountingShell>
  );
}

function Field({ label, value, onChange, type = "text", options = [] }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      {type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
          {options.map((option) => (
            <option key={option} value={option} className="bg-zinc-950 text-white">
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
      )}
    </label>
  );
}

export default CashRegisters;
