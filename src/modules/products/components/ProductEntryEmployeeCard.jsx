import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

import ThemedSelect from "../../../shared/ui/ThemedSelect";
import { getProductEntryEmployees, verifyProductEntryEmployee } from "../services/productsApi";

/*
 * "مين اللي دخّل المنتج ده".
 *
 * ERP logins are shared on the shop floor, so the product save asks for the
 * person, not the account: the employee picks their name and types the PIN they
 * set from their own portal link. The PIN is checked on its own request and
 * exchanged for a short-lived signed token — the PIN itself never sits in the
 * form state and never travels with the product payload.
 *
 * The name is what the product history dialog then shows next to the colours
 * that were created in this save.
 */
export const useProductEntryEmployee = () => {
  const [employees, setEmployees] = useState([]);
  const [required, setRequired] = useState(true);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState("");
  const [verifiedEmployee, setVerifiedEmployee] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { employees: rows, required: isRequired } = await getProductEntryEmployees();
        if (cancelled) return;
        setEmployees(Array.isArray(rows) ? rows : []);
        setRequired(isRequired !== false);
      } catch {
        // A failed list must not block the form: the save still refuses without
        // a verified employee, and the error is shown there.
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Switching the name invalidates the proof: a token belongs to one employee.
  const selectEmployee = useCallback((nextId) => {
    setEmployeeId(String(nextId || ""));
    setPin("");
    setToken("");
    setVerifiedEmployee(null);
    setError("");
  }, []);

  const verify = useCallback(async () => {
    if (verifying) return false;
    if (!employeeId) {
      setError("اختر اسمك من القائمة الأول");
      return false;
    }
    if (!String(pin || "").trim()) {
      setError("اكتب رقمك السري");
      return false;
    }
    try {
      setVerifying(true);
      setError("");
      const { employee, token: nextToken } = await verifyProductEntryEmployee({ employeeId, pin });
      setToken(nextToken || "");
      setVerifiedEmployee(employee);
      setPin("");
      return true;
    } catch (requestError) {
      setToken("");
      setVerifiedEmployee(null);
      setError(requestError?.responseBody?.message || requestError?.message || "تعذر التأكد من الرقم السري");
      return false;
    } finally {
      setVerifying(false);
    }
  }, [employeeId, pin, verifying]);

  const isVerified = Boolean(token && verifiedEmployee);

  return {
    employees,
    required,
    loading,
    employeeId,
    selectEmployee,
    pin,
    setPin,
    verify,
    verifying,
    error,
    setError,
    isVerified,
    verifiedEmployee,
    // Everything the product save needs to stamp the person on the record.
    payload: isVerified ? { entry_employee_token: token, entry_employee_id: verifiedEmployee.id } : {},
    isReady: isVerified || !required,
  };
};

export default function ProductEntryEmployeeCard({ state }) {
  const { t } = useTranslation();
  const {
    employees,
    required,
    loading,
    employeeId,
    selectEmployee,
    pin,
    setPin,
    verify,
    verifying,
    error,
    isVerified,
    verifiedEmployee,
  } = state;

  const options = useMemo(
    () =>
      employees.map((employee) => ({
        value: String(employee.id),
        // An employee with no PIN yet is listed but cannot be picked, so the
        // name that is missing is obvious instead of simply absent.
        label: employee.has_pin
          ? employee.name
          : `${employee.name} — ${t("products.entryEmployee.noPinYet", "لسه ماعملش رقم سري")}`,
        disabled: !employee.has_pin,
      })),
    [employees, t]
  );

  if (isVerified) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-success/40 bg-success/10 px-4 py-3">
        <CheckCircle2 size={18} strokeWidth={2} className="text-success" />
        <p className="text-sm font-semibold text-text">
          {t("products.entryEmployee.verified", "تم التأكيد: {{name}}", { name: verifiedEmployee?.name || "" })}
        </p>
        <button
          type="button"
          onClick={() => selectEmployee("")}
          className="ms-auto h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-border bg-surface px-3 text-xs font-bold text-text"
        >
          {t("products.entryEmployee.change", "تغيير الموظف")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <label className="text-sm font-semibold text-text">{t("products.entryEmployee.employee", "الموظف")}</label>
        <ThemedSelect
          value={employeeId}
          onChange={(value) => selectEmployee(value)}
          options={options}
          placeholder={loading ? t("common.loading", "جارٍ التحميل...") : t("products.entryEmployee.pickEmployee", "اختر اسمك")}
          ariaLabel={t("products.entryEmployee.employee", "الموظف")}
          triggerClassName="mt-2 w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-text"
        />
      </div>
      <div className="min-w-0">
        <label className="text-sm font-semibold text-text">{t("products.entryEmployee.pin", "الرقم السري")}</label>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            onKeyDown={(event) => {
              // Enter inside the product form would submit it; here it confirms.
              if (event.key !== "Enter") return;
              event.preventDefault();
              verify();
            }}
            placeholder="••••"
            className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-text outline-none placeholder:text-text-muted"
            dir="ltr"
          />
          <button
            type="button"
            onClick={verify}
            disabled={verifying}
            className="inline-flex h-auto shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-primary/40 bg-primary/10 px-4 text-sm font-bold text-primary disabled:opacity-60"
          >
            {verifying ? <Loader2 size={16} strokeWidth={2} className="animate-spin" /> : <ShieldCheck size={16} strokeWidth={2} />}
            {t("products.entryEmployee.confirm", "تأكيد")}
          </button>
        </div>
      </div>
      <p className="md:col-span-2 flex items-center gap-2 text-xs text-text-muted">
        <LockKeyhole size={14} strokeWidth={2} />
        {required
          ? t("products.entryEmployee.requiredHint", "لازم تأكيد الموظف قبل حفظ المنتج. الرقم السري بيتعمل من بوابة الموظف.")
          : t("products.entryEmployee.optionalHint", "التأكيد اختياري، بس من غيره السجل مش هيعرف مين دخّل المنتج.")}
      </p>
      {error ? <p className="md:col-span-2 text-sm font-semibold text-danger">{error}</p> : null}
    </div>
  );
}
