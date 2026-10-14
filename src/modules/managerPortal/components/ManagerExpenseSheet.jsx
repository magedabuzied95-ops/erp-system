import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ReceiptText, X } from "lucide-react";
import toast from "react-hot-toast";
import i18n from "../../../i18n/i18n";
import ThemedSelect from "../../../shared/ui/ThemedSelect";
import { managerPortalApi } from "../services/managerPortalApi";

const tt = (key, options) => i18n.t(key, options);

// The POS "مصروف" dialog, field for field: the same categories (the till's own
// labels), the employee advance, cash / card / wallet and notes. The one thing a
// manager adds is WHICH drawer pays it, because the manager has no till of their own.
const EXPENSE_CATEGORIES = [
  "delivery",
  "snacks",
  "cleaning",
  "small_purchases",
  "water",
  "electricity",
  "shipping",
  "maintenance",
  "other",
  "employee_advance",
];
const PAYMENT_METHODS = ["cash", "card", "wallet"];
const emptyExpense = { category: "delivery", employee_id: "", amount: "", payment_method: "cash", notes: "" };

const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() || `mp-expense-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const fieldLabel = "mb-1.5 block text-[11px] font-black text-slate-500";
const inputClass =
  "w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-sm font-black text-text outline-none focus:border-primary";

export default function ManagerExpenseSheet({ token, onClose, onSaved }) {
  const [context, setContext] = useState({ loading: true, shifts: [], employees: [], error: "" });
  const [shiftId, setShiftId] = useState("");
  const [value, setValue] = useState(emptyExpense);
  const [saving, setSaving] = useState(false);
  // One key per expense the manager is filling in: a double tap or a retried
  // request books the drawer once.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    let alive = true;
    managerPortalApi
      .expenseContext(token)
      .then((response) => {
        if (!alive) return;
        const shifts = Array.isArray(response?.shifts) ? response.shifts : [];
        setContext({ loading: false, shifts, employees: Array.isArray(response?.employees) ? response.employees : [], error: "" });
        if (shifts.length === 1) setShiftId(String(shifts[0].id));
      })
      .catch((error) => {
        if (alive) setContext({ loading: false, shifts: [], employees: [], error: error?.message || tt("managerPortal.quickExpense.loadFailed") });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const shift = context.shifts.find((item) => String(item.id) === String(shiftId)) || null;
  const isEmployeeAdvance = value.category === "employee_advance";

  const shiftOptions = useMemo(
    () =>
      context.shifts.map((item) => ({
        value: String(item.id),
        label: `${item.branch_name || ""} · ${item.cashier_name || ""} #${item.id}`,
      })),
    [context.shifts]
  );
  const categoryOptions = useMemo(
    () => EXPENSE_CATEGORIES.map((key) => ({ value: key, label: tt(`pos.posPro.quickExpenseCategories.${key}`) })),
    []
  );
  // Same rule the server applies: an employee of the drawer's branch, or of no branch.
  const employeeOptions = useMemo(
    () =>
      context.employees
        .filter((employee) => !shift || !employee.branch_id || String(employee.branch_id) === String(shift.branch_id))
        .map((employee) => ({ value: String(employee.id), label: employee.name })),
    [context.employees, shift]
  );

  const update = (field, nextValue) =>
    setValue((prev) => {
      const next = { ...prev, [field]: nextValue };
      if (field === "category" && nextValue !== "employee_advance") next.employee_id = "";
      return next;
    });

  const close = () => {
    if (!saving) onClose();
  };

  const save = async () => {
    if (!shift) {
      toast.error(tt("managerPortal.quickExpense.invalidShift"));
      return;
    }
    const amount = Number(value.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tt("managerPortal.quickExpense.invalidAmount"));
      return;
    }
    if (isEmployeeAdvance && !value.employee_id) {
      toast.error(tt("managerPortal.quickExpense.selectEmployee"));
      return;
    }
    setSaving(true);
    try {
      await managerPortalApi.createExpense(
        token,
        {
          category: value.category,
          expense_type: value.category,
          amount,
          payment_method: value.payment_method,
          notes: value.notes,
          employee_id: isEmployeeAdvance ? value.employee_id : null,
          shift_id: shift.id,
          branch_id: shift.branch_id,
          idempotency_key: idempotencyKey,
        },
        idempotencyKey
      );
      toast.success(isEmployeeAdvance ? tt("managerPortal.quickExpense.advanceSaved") : tt("managerPortal.quickExpense.saved"));
      setValue(emptyExpense);
      setIdempotencyKey(newIdempotencyKey());
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error?.message || tt("managerPortal.quickExpense.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 p-3 sm:items-center">
      <button type="button" aria-label={tt("managerPortal.quickExpense.close")} onClick={close} className="absolute inset-0" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manager-expense-title"
        className="relative w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-4 text-text shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="manager-expense-title" className="m1-section-title">{tt("pos.posPro.chrome.expense")}</h3>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500">
              {shift ? `${shift.branch_name || ""} #${shift.id}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label={tt("managerPortal.quickExpense.close")}
            className="inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {context.loading ? (
          <div className="flex min-h-[10rem] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : context.error || !context.shifts.length ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 text-sm font-bold leading-6 text-slate-600">
            {context.error || tt("managerPortal.quickExpense.noOpenShift")}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <span className={fieldLabel}>{tt("managerPortal.quickExpense.drawer")}</span>
              <ThemedSelect
                value={shiftId}
                onChange={(next) => setShiftId(String(next ?? ""))}
                options={shiftOptions}
                placeholder={tt("managerPortal.quickExpense.selectShift")}
                ariaLabel={tt("managerPortal.quickExpense.drawer")}
              />
            </div>

            <div>
              <span className={fieldLabel}>{tt("pos.posPro.misc.type")}</span>
              <ThemedSelect
                value={value.category}
                onChange={(next) => update("category", String(next ?? ""))}
                options={categoryOptions}
                ariaLabel={tt("pos.posPro.misc.type")}
              />
            </div>

            {isEmployeeAdvance ? (
              <div>
                <span className={fieldLabel}>{tt("pos.shift.employee")}</span>
                <ThemedSelect
                  value={value.employee_id || ""}
                  onChange={(next) => update("employee_id", String(next ?? ""))}
                  options={employeeOptions}
                  placeholder={tt("pos.shift.selectEmployee")}
                  ariaLabel={tt("pos.shift.employee")}
                />
              </div>
            ) : null}

            <label className="block">
              <span className={fieldLabel}>{tt("pos.posPro.misc.amount")}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={value.amount}
                onChange={(event) => update("amount", event.target.value)}
                autoFocus
                dir="ltr"
                className={`${inputClass} h-[var(--control-height-lg)] text-lg`}
                placeholder="0.00"
              />
            </label>

            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => update("payment_method", method)}
                  aria-pressed={value.payment_method === method}
                  className={`h-[var(--control-height-md)] rounded-[var(--radius-control)] border text-xs font-black transition ${value.payment_method === method ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface-soft text-text"}`}
                >
                  {tt(`managerPortal.quickExpense.methods.${method}`)}
                </button>
              ))}
            </div>

            <label className="block">
              <span className={fieldLabel}>{tt("pos.posPro.misc.notes")}</span>
              <textarea
                rows={3}
                value={value.notes}
                onChange={(event) => update("notes", event.target.value)}
                className={`${inputClass} resize-none py-3 font-semibold`}
                placeholder={tt("pos.cart.optional")}
              />
            </label>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-border bg-surface-soft text-sm font-black text-text disabled:opacity-50"
          >
            {tt("managerPortal.quickExpense.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || context.loading || !context.shifts.length}
            className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
            {tt("managerPortal.quickExpense.save")}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
