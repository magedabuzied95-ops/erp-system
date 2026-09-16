import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { KeyRound, ShieldCheck } from "lucide-react";

import { api } from "../../shared/api/api";
import { getCurrentUser, setAuth } from "../../shared/auth/authStorage";
import MfaEnrollmentPanel, { RecoveryCodesList, inputClass, primaryButton, secondaryButton } from "./MfaEnrollmentPanel";

const card = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5";

const formatDate = (value, locale) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
};

// A password or MFA change ends every other session; the server hands this tab a fresh token.
const keepSession = (token) => {
  if (token) setAuth({ token, user: getCurrentUser() });
};

export default function AccountSecurity() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [sensitiveAction, setSensitiveAction] = useState(null); // "disable" | "codes"
  const [actionPassword, setActionPassword] = useState("");
  const [actionCode, setActionCode] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      setStatus(await api.get("/auth/security"));
    } catch (error) {
      setLoadError(error?.message || t("access.security.unknown"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const changePassword = async (event) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      toast.error(t("access.security.passwordsMismatch"));
      return;
    }
    setBusy(true);
    try {
      const data = await api.post("/auth/password", { current_password: passwords.current, new_password: passwords.next });
      keepSession(data?.token);
      setPasswords({ current: "", next: "", confirm: "" });
      try {
        sessionStorage.removeItem("m1-password-notice");
      } catch {
        // Banner only.
      }
      toast.success(t("access.security.passwordChanged"));
      load();
    } catch (error) {
      toast.error(error?.message || t("access.security.unknown"));
    } finally {
      setBusy(false);
    }
  };

  const runSensitiveAction = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (sensitiveAction === "disable") {
        const data = await api.post("/auth/mfa/disable", { password: actionPassword, code: actionCode.trim() });
        keepSession(data?.token);
        toast.success(t("access.security.mfaDisabledToast"));
      } else {
        const data = await api.post("/auth/mfa/recovery-codes", { password: actionPassword, code: actionCode.trim() });
        setRecoveryCodes(data?.recovery_codes || []);
      }
      setSensitiveAction(null);
      setActionPassword("");
      setActionCode("");
      load();
    } catch (error) {
      toast.error(error?.message || t("access.security.unknown"));
    } finally {
      setBusy(false);
    }
  };

  const mfa = status?.mfa;
  const locale = i18n.language === "ar" ? "ar-EG" : "en-GB";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="m1-page-title text-[var(--text)]">{t("access.security.title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("access.security.subtitle")}</p>
      </div>

      {loadError ? <div className={`${card} text-[var(--danger)]`}>{loadError}</div> : null}

      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-black text-[var(--text)]">
            <ShieldCheck className="h-5 w-5" />
            {t("access.security.mfaTitle")}
          </h2>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${mfa?.enabled ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>
            {mfa?.enabled ? t("access.security.mfaEnabled") : t("access.security.mfaDisabled")}
          </span>
        </div>

        {status?.mfa_required_for_you ? (
          <p className="mt-3 text-sm font-semibold text-[var(--text)]">{t("access.security.mfaRequiredNotice")}</p>
        ) : status?.mfa_applies_to_you && !mfa?.enabled ? (
          <p className="mt-3 text-sm font-semibold text-amber-600">{t("access.security.mfaRecommendedNotice")}</p>
        ) : null}

        {mfa?.enabled ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-[var(--muted)]">{t("access.security.mfaEnrolledAt")}</dt>
            <dd className="text-[var(--text)]">{formatDate(mfa.enrolled_at, locale)}</dd>
            <dt className="text-[var(--muted)]">{t("access.security.recoveryRemaining")}</dt>
            <dd className="text-[var(--text)]">{mfa.recovery_codes_remaining}</dd>
          </dl>
        ) : null}

        <div className="mt-4 space-y-3">
          {recoveryCodes ? (
            <RecoveryCodesList codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />
          ) : enrolling ? (
            <MfaEnrollmentPanel
              startPath="/auth/mfa/enroll/start"
              confirmPath="/auth/mfa/enroll/confirm"
              onCancel={() => setEnrolling(false)}
              onConfirmed={(data) => {
                keepSession(data?.token);
                setEnrolling(false);
                setRecoveryCodes(data?.recovery_codes || []);
                toast.success(t("access.security.mfaEnabledToast"));
                load();
              }}
            />
          ) : sensitiveAction ? (
            <form onSubmit={runSensitiveAction} className="space-y-3">
              <input type="password" autoComplete="current-password" placeholder={t("access.security.currentPassword")} value={actionPassword} onChange={(event) => setActionPassword(event.target.value)} className={inputClass} />
              <input type="text" dir="ltr" autoComplete="one-time-code" placeholder={t("access.security.codeOrRecovery")} value={actionCode} onChange={(event) => setActionCode(event.target.value)} className={`${inputClass} text-center tracking-[0.3em]`} />
              <button type="submit" disabled={busy || !actionPassword || actionCode.trim().length < 6} className={primaryButton}>
                {sensitiveAction === "disable" ? t("access.security.disable") : t("access.security.regenerateCodes")}
              </button>
              <button type="button" onClick={() => setSensitiveAction(null)} className={secondaryButton}>
                {t("access.security.cancel")}
              </button>
            </form>
          ) : mfa?.enabled ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setSensitiveAction("codes")} className={secondaryButton}>
                {t("access.security.regenerateCodes")}
              </button>
              {!status?.mfa_required_for_you ? (
                <button type="button" onClick={() => setSensitiveAction("disable")} className={secondaryButton}>
                  {t("access.security.disable")}
                </button>
              ) : null}
            </div>
          ) : status ? (
            <button type="button" onClick={() => setEnrolling(true)} className={primaryButton}>
              {t("access.security.enable")}
            </button>
          ) : null}
        </div>
      </section>

      <section className={card}>
        <h2 className="flex items-center gap-2 text-lg font-black text-[var(--text)]">
          <KeyRound className="h-5 w-5" />
          {t("access.security.passwordTitle")}
        </h2>
        {status?.password ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-[var(--muted)]">{t("access.security.passwordChangedAt")}</dt>
            <dd className="text-[var(--text)]">{formatDate(status.password.changed_at, locale)}</dd>
            <dt className="text-[var(--muted)]">{t("access.security.passwordExpiresAt")}</dt>
            <dd className={status.password.days_left <= 14 ? "font-bold text-[var(--danger)]" : "text-[var(--text)]"}>
              {formatDate(status.password.expires_at, locale)} ({Math.max(0, status.password.days_left)} {t("access.security.daysLeft")})
            </dd>
          </dl>
        ) : null}
        <p className="mt-3 text-xs text-[var(--muted)]">{t("access.security.passwordPolicy")}</p>
        <form onSubmit={changePassword} className="mt-3 space-y-3">
          <input type="password" autoComplete="current-password" placeholder={t("access.security.currentPassword")} value={passwords.current} onChange={(event) => setPasswords((prev) => ({ ...prev, current: event.target.value }))} className={inputClass} />
          <input type="password" autoComplete="new-password" placeholder={t("access.security.newPassword")} value={passwords.next} onChange={(event) => setPasswords((prev) => ({ ...prev, next: event.target.value }))} className={inputClass} />
          <input type="password" autoComplete="new-password" placeholder={t("access.security.confirmPassword")} value={passwords.confirm} onChange={(event) => setPasswords((prev) => ({ ...prev, confirm: event.target.value }))} className={inputClass} />
          <button type="submit" disabled={busy || !passwords.current || !passwords.next} className={primaryButton}>
            {t("access.security.changePassword")}
          </button>
        </form>
      </section>
    </div>
  );
}
