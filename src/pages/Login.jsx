import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../shared/api/api";
import { isMetaReviewerUser, setAuth, getCurrentTenant, setCurrentTenant } from "../shared/auth/authStorage";
import { API_BASE_URL } from "../shared/constants/app.js?m1PreviewApi=2";
import { resolveBrandImageUrl } from "../shared/lib/imageUrls";
import MfaEnrollmentPanel, { RecoveryCodesList, inputClass, primaryButton } from "../modules/security/MfaEnrollmentPanel";

function BrandBadge({ name, logoUrl }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const initials =
    String(name || "MONE")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "MONE";

  return (
    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] text-lg font-black text-[var(--text)]">
      {logoUrl && !failed ? (
        <img
          src={logoUrl}
          alt={name}
          className="h-full w-full object-contain p-2"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState(getCurrentTenant()?.slug || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [publicSettings, setPublicSettings] = useState({});
  // Sign-in steps after the password: mfa_required | mfa_enrollment_required | password_change_required
  const [step, setStep] = useState(null);
  const [stepCode, setStepCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pendingLogin, setPendingLogin] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get("/settings/public", { suppressErrorStatuses: [401, 403, 404, 500] })
      .then((response) => {
        if (!alive) return;
        setPublicSettings(response?.settings || {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const brandName =
    publicSettings?.["general.company_name"] ||
    publicSettings?.["storefront.store_name"] ||
    "MONE";
  // Settings store the logo as a backend-relative /uploads path; rendered raw it
  // hits the app origin, which answers the SPA shell instead of the image.
  const brandLogo = resolveBrandImageUrl(
    publicSettings?.["general.company_logo_url"] ||
    publicSettings?.["storefront.store_logo_url"] ||
    ""
  );
  const brandInitials =
    String(brandName || "MONE")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "MONE";

  const resetSteps = (message = "") => {
    setStep(null);
    setStepCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPendingLogin(null);
    setError(message);
  };

  const stepErrorMessage = (stepError) =>
    stepError?.status === 401 ? t("access.security.stepExpired") : stepError?.message || t("access.security.unknown");

  const completeLogin = (data) => {
    const tenant =
      data?.tenant ||
      data?.user?.tenant ||
      {
        id: data?.user?.tenant_id || workspace || "",
        slug: data?.user?.tenant_slug || workspace || "",
        name: data?.user?.tenant_name || data?.user?.company_name || workspace || "Workspace",
        companyName: data?.user?.company_name || data?.user?.tenant_name || workspace || "Workspace",
        companyLogoUrl: data?.tenant?.companyLogoUrl || data?.tenant?.company_logo_url || data?.user?.company_logo_url || "",
        faviconUrl: data?.tenant?.faviconUrl || data?.tenant?.favicon_url || data?.user?.favicon_url || "",
      };

    if (tenant?.id || tenant?.slug || tenant?.name) {
      setCurrentTenant(tenant);
    }

    setAuth({
      token: data.token,
      user: {
        ...data.user,
        tenant_id: data?.user?.tenant_id || tenant?.id || "",
        tenant_slug: data?.user?.tenant_slug || tenant?.slug || workspace || "",
        tenant_name: data?.user?.tenant_name || tenant?.name || workspace || "",
        company_name: data?.user?.company_name || tenant?.companyName || tenant?.name || "",
        company_logo_url: data?.user?.company_logo_url || tenant?.companyLogoUrl || tenant?.company_logo_url || "",
        favicon_url: data?.user?.favicon_url || tenant?.faviconUrl || tenant?.favicon_url || "",
      },
    });

    const status = data?.password_status;
    if (status && (status.compliant === false || Number(status.days_left) <= 14)) {
      try {
        sessionStorage.setItem("m1-password-notice", status.compliant === false ? "weak" : "expiring");
      } catch {
        // Banner only.
      }
    }

    window.location.href = isMetaReviewerUser(data?.user) ? "/admin/ai-inbox" : "/dashboard";
  };

  const submitMfaCode = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError("");
      const data = await api.post("/auth/login/mfa", { challenge_token: step.challenge_token, code: stepCode.trim() });
      completeLogin(data);
    } catch (stepError) {
      if (stepError?.status === 401) resetSteps(stepErrorMessage(stepError));
      else setError(stepErrorMessage(stepError));
    } finally {
      setLoading(false);
    }
  };

  const submitPasswordChange = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setError(t("access.security.passwordsMismatch"));
      return;
    }
    try {
      setLoading(true);
      setError("");
      await api.post("/auth/login/password-change", {
        challenge_token: step.challenge_token,
        current_password: password,
        new_password: newPassword,
      });
      resetSteps("");
      setPassword("");
      setNotice(t("access.security.passwordChanged"));
    } catch (stepError) {
      if (stepError?.status === 401) resetSteps(stepErrorMessage(stepError));
      else setError(stepErrorMessage(stepError));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");
      setNotice("");

      const previewApiBase = typeof window !== "undefined" && window.location.hostname.endsWith(".nip.io") ? "/api" : API_BASE_URL;
      const loginUrl = `${previewApiBase}/auth/login`;
      console.log("[login] api base:", previewApiBase);
      console.log("[login] request url:", loginUrl);

      const data = await api.post("/auth/login", {
        email,
        password,
        workspace,
        tenant_slug: workspace,
        tenant: workspace,
      });

      if (data?.step) {
        setStep(data);
        setStepCode("");
        return;
      }

      completeLogin(data);
    } catch (loginError) {
      console.log(loginError);
      console.error("[login] fetch error details:", {
        message: loginError.message,
        stack: loginError.stack,
      });

      setError(loginError.message);
    } finally {
      setLoading(false);
    }
  };

  const stepShell = (title, help, body) => (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md rounded-[30px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-2xl shadow-black/20">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandBadge name={brandName} logoUrl={brandLogo} />
          <h1 className="m1-page-title mt-4 text-[var(--text)]">{title}</h1>
          {help ? <p className="mt-2 text-sm text-[var(--muted)]">{help}</p> : null}
        </div>
        {body}
        {error ? <p className="mt-4 text-center text-[var(--danger)]">{error}</p> : null}
        {!pendingLogin ? (
          <button type="button" onClick={() => resetSteps("")} className="mt-4 w-full text-center text-sm font-semibold text-[var(--muted)] underline">
            {t("access.security.backToLogin")}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (pendingLogin) {
    return stepShell(
      t("access.security.loginEnrollTitle"),
      null,
      <RecoveryCodesList codes={pendingLogin.recovery_codes || []} onDone={() => completeLogin(pendingLogin)} />
    );
  }

  if (step?.step === "mfa_required") {
    return stepShell(
      t("access.security.loginMfaTitle"),
      t("access.security.loginMfaHelp"),
      <form onSubmit={submitMfaCode} className="space-y-3">
        <input
          type="text"
          autoComplete="one-time-code"
          autoFocus
          dir="ltr"
          maxLength={11}
          placeholder={t("access.security.codeOrRecovery")}
          value={stepCode}
          onChange={(event) => setStepCode(event.target.value)}
          className={`${inputClass} text-center tracking-[0.3em]`}
        />
        <button type="submit" disabled={loading || stepCode.trim().length < 6} className={primaryButton}>
          {t("access.security.confirm")}
        </button>
      </form>
    );
  }

  if (step?.step === "mfa_enrollment_required") {
    return stepShell(
      t("access.security.loginEnrollTitle"),
      t("access.security.loginEnrollHelp"),
      <MfaEnrollmentPanel
        startPath="/auth/login/mfa-enroll/start"
        confirmPath="/auth/login/mfa-enroll/confirm"
        extraBody={{ challenge_token: step.challenge_token }}
        onConfirmed={(data) => setPendingLogin(data)}
      />
    );
  }

  if (step?.step === "password_change_required") {
    const reasons = step.password_status?.reasons || [];
    const reasonLabel = { expired: "reasonExpired", weak: "reasonWeak", reset_by_admin: "reasonReset" };
    return stepShell(
      t("access.security.loginPasswordTitle"),
      t("access.security.loginPasswordHelp"),
      <form onSubmit={submitPasswordChange} className="space-y-3">
        {reasons.length ? (
          <ul className="list-inside list-disc text-sm text-[var(--danger)]">
            {reasons.map((reason) => <li key={reason}>{t(`access.security.${reasonLabel[reason] || "unknown"}`)}</li>)}
          </ul>
        ) : null}
        <p className="text-xs text-[var(--muted)]">{t("access.security.passwordPolicy")}</p>
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t("access.security.newPassword")}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t("access.security.confirmPassword")}
          value={confirmNewPassword}
          onChange={(event) => setConfirmNewPassword(event.target.value)}
          className={inputClass}
        />
        <button type="submit" disabled={loading || !newPassword} className={primaryButton}>
          {t("access.security.changePassword")}
        </button>
      </form>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-[30px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-2xl shadow-black/20"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandBadge name={brandName} logoUrl={brandLogo} />
          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.24em] text-[var(--muted)]">
            Workspace
          </div>
          <div className="mt-1 text-xl font-black text-[var(--text)]">
            {brandName || "MONE"}
          </div>
        </div>

        <h1 className="m1-page-title mb-2 text-center text-[var(--text)]">
          تسجيل الدخول
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--muted)]">
          سجّل دخولك إلى مساحة العمل
        </p>

        <input
          type="email"
          placeholder={t("common.login.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />

        <input
          type="password"
          placeholder={t("common.login.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />

        <input
          type="text"
          placeholder={t("common.login.workspace")}
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          className="mb-4 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[var(--radius-control)] bg-[var(--primary)] px-4 py-3 font-semibold text-white"
        >
          {loading ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
        </button>

        {notice ? (
          <p className="mt-4 text-center text-[var(--success,#16a34a)]">{notice}</p>
        ) : null}
        {error ? (
          <p className="mt-4 text-center text-[var(--danger)]">{error}</p>
        ) : null}
      </form>
    </div>
  );
}

export default Login;
