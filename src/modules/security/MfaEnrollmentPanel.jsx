import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../shared/api/api";

const inputClass =
  "w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--text)] outline-none placeholder:text-[var(--muted)]";
const primaryButton =
  "w-full rounded-[var(--radius-control)] bg-[var(--primary)] px-4 py-3 font-semibold text-white disabled:opacity-60";
const secondaryButton =
  "w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 font-semibold text-[var(--text)]";

export function RecoveryCodesList({ codes = [], onDone }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-black text-[var(--text)]">{t("access.security.recoveryTitle")}</h3>
      <p className="text-sm text-[var(--muted)]">{t("access.security.recoveryHelp")}</p>
      <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3 font-mono text-sm text-[var(--text)]">
        {codes.map((code) => (
          <li key={code} className="text-center tracking-wider">{code}</li>
        ))}
      </ul>
      <button type="button" onClick={copy} className={secondaryButton}>
        {copied ? t("access.security.copied") : t("access.security.copyCodes")}
      </button>
      {onDone ? (
        <button type="button" onClick={onDone} className={primaryButton}>
          {t("access.security.continue")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Two-step TOTP enrolment. `startPath` / `confirmPath` differ between the sign-in step
 * (challenge token in the body) and the signed-in security page (session token).
 * `onConfirmed(responseBody)` receives the server's answer, including recovery_codes.
 */
export default function MfaEnrollmentPanel({ startPath, confirmPath, extraBody = {}, onConfirmed, onCancel }) {
  const { t } = useTranslation();
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      setEnrollment(await api.post(startPath, { ...extraBody }));
    } catch (err) {
      setError(err?.status === 401 ? t("access.security.stepExpired") : err?.message || t("access.security.unknown"));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api.post(confirmPath, { ...extraBody, code: code.replace(/\s+/g, "") });
      setEnrollment(null);
      setCode("");
      onConfirmed?.(data);
    } catch (err) {
      setError(err?.status === 401 ? t("access.security.stepExpired") : err?.message || t("access.security.unknown"));
    } finally {
      setBusy(false);
    }
  };

  if (!enrollment) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={start} disabled={busy} className={primaryButton}>
          {t("access.security.startEnroll")}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            {t("access.security.cancel")}
          </button>
        ) : null}
        {error ? <p className="text-center text-sm text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-3">
      <p className="text-sm text-[var(--muted)]">{t("access.security.scanQr")}</p>
      <div className="flex justify-center">
        <img src={enrollment.qr_data_url} alt="QR" width={220} height={220} className="rounded-[var(--radius-card)] bg-white p-2" />
      </div>
      <div className="text-center">
        <div className="text-xs text-[var(--muted)]">{t("access.security.manualKey")}</div>
        <div dir="ltr" className="mt-1 select-all break-all font-mono text-sm font-bold text-[var(--text)]">{enrollment.manual_entry_key}</div>
      </div>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        dir="ltr"
        placeholder={t("access.security.code")}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className={`${inputClass} text-center tracking-[0.4em]`}
      />
      <button type="submit" disabled={busy || code.replace(/\s+/g, "").length !== 6} className={primaryButton}>
        {t("access.security.confirm")}
      </button>
      {onCancel ? (
        <button type="button" onClick={onCancel} className={secondaryButton}>
          {t("access.security.cancel")}
        </button>
      ) : null}
      {error ? <p className="text-center text-sm text-[var(--danger)]">{error}</p> : null}
    </form>
  );
}

export { inputClass, primaryButton, secondaryButton };
