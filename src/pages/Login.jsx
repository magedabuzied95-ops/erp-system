import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

import { api } from "../shared/api/api";
import { isMetaReviewerUser, setAuth, getCurrentTenant, setCurrentTenant } from "../shared/auth/authStorage";
import { resolveBrandImageUrl } from "../shared/lib/imageUrls";
import { currentBuildId } from "../shared/lib/portalBuildUpdate";
import {
  applyDocumentLanguage,
  getStoredLanguage,
  normalizeLanguage,
  persistApplicationLanguage,
  whenLocalesReady,
} from "../i18n/i18n";
import MfaEnrollmentPanel, { RecoveryCodesList } from "../modules/security/MfaEnrollmentPanel";
import "./Login.css";

const LANGUAGES = ["ar", "en"];

// The last brand this device saw, so the logo paints at once instead of after
// /settings/public answers. Per-device convenience only.
const BRAND_CACHE_KEY = "m1.login.brand";

const readCachedBrand = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(BRAND_CACHE_KEY) || "null");
    return cached && typeof cached === "object" ? cached : null;
  } catch {
    return null;
  }
};

const writeCachedBrand = (brand) => {
  try {
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(brand));
  } catch {
    // Storage blocked: the page still renders from the live settings.
  }
};

const initialBrand = () => {
  const cached = readCachedBrand();
  if (cached) return cached;
  const tenant = getCurrentTenant() || {};
  return {
    name: tenant.companyName || tenant.company_name || tenant.name || "",
    logo: tenant.companyLogoUrl || tenant.company_logo_url || "",
    tagline: "",
  };
};

const brandInitials = (name) =>
  String(name || "MONE")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "MONE";

const formatCountdown = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function BrandLogo({ name, logoUrl, size }) {
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState(null);

  // A square-ish mark (the usual round badge) fills a circle; a wordmark or a
  // tall mark keeps its whole shape inside a rounded frame.
  const measure = useCallback((img) => {
    if (!img?.complete || !img.naturalWidth || !img.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    setShape(ratio >= 0.8 && ratio <= 1.25 ? "round" : "framed");
  }, []);

  const style = { "--logo-size": `${size}px` };

  if (!logoUrl || failed) {
    return (
      <div className="m1-login-logo m1-login-logo--initials" style={style} role="img" aria-label={name}>
        <span>{brandInitials(name)}</span>
      </div>
    );
  }

  return (
    <div className={`m1-login-logo m1-login-logo--${shape || "round"}${shape ? " is-loaded" : ""}`} style={style}>
      <img
        ref={measure}
        src={logoUrl}
        alt={name}
        decoding="async"
        draggable="false"
        onLoad={(event) => measure(event.currentTarget)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, autoFocus = false }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const trackCapsLock = (event) => {
    if (typeof event.getModifierState === "function") setCapsLock(event.getModifierState("CapsLock"));
  };

  return (
    <div className="m1-login__field">
      <label htmlFor={id} className="m1-login__label">{label}</label>
      <div className="m1-login__pw">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          required
          value={value}
          onChange={onChange}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          className="m1-login__input"
        />
        <button
          type="button"
          className="m1-login__eye"
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
          aria-label={visible ? t("common.login.hidePassword") : t("common.login.showPassword")}
          title={visible ? t("common.login.hidePassword") : t("common.login.showPassword")}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {capsLock ? (
        <p className="m1-login__caps" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          {t("common.login.capsLock")}
        </p>
      ) : null}
    </div>
  );
}

function Login() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Sent quietly on every attempt; the field only shows when the server needs it
  // (the same email exists in more than one company).
  const [workspace, setWorkspace] = useState(getCurrentTenant()?.slug || "");
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lock, setLock] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [brand, setBrand] = useState(initialBrand);
  // Sign-in steps after the password: mfa_required | mfa_enrollment_required | password_change_required
  const [step, setStep] = useState(null);
  const [stepCode, setStepCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pendingLogin, setPendingLogin] = useState(null);
  const [notice, setNotice] = useState(null);
  const workspaceRef = useRef(null);
  const [buildId] = useState(() => currentBuildId());

  const language = normalizeLanguage(i18n.resolvedLanguage || i18n.language);

  const changeLanguage = useCallback(
    async (next, { persist }) => {
      await whenLocalesReady().catch(() => {});
      if (persist) persistApplicationLanguage(next);
      await i18n.changeLanguage(next);
      applyDocumentLanguage(next);
    },
    [i18n]
  );

  useEffect(() => {
    let alive = true;
    api
      .get("/settings/public", { suppressErrorStatuses: [401, 403, 404, 500] })
      .then((response) => {
        if (!alive || !response?.settings) return;
        const settings = response.settings;
        const next = {
          name: settings["general.company_name"] || settings["storefront.store_name"] || "",
          logo: settings["general.company_logo_url"] || settings["storefront.store_logo_url"] || "",
          tagline: settings["storefront.store_tagline"] || "",
        };
        setBrand(next);
        writeCachedBrand(next);

        // A device that never picked a language opens in the store's default one.
        const storeLanguage = settings["general.default_language"];
        if (storeLanguage && !getStoredLanguage()) {
          const target = normalizeLanguage(storeLanguage);
          if (target !== normalizeLanguage(i18n.resolvedLanguage || i18n.language)) {
            changeLanguage(target, { persist: false });
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [changeLanguage, i18n]);

  useEffect(() => {
    if (!lock) return undefined;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= lock.until) setLock(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lock]);

  useEffect(() => {
    if (showWorkspace) workspaceRef.current?.focus();
  }, [showWorkspace]);

  const brandName = brand.name || "MONE";
  const brandLogo = resolveBrandImageUrl(brand.logo);
  const lockedSeconds =
    lock && lock.email === email.trim().toLowerCase() ? Math.max(0, Math.ceil((lock.until - now) / 1000)) : 0;

  // Messages are kept as { key } (translated at render, so they follow a language
  // switch) or { text } for a server sentence we have no key for.
  const messageText = (message) => (message?.key ? t(message.key) : message?.text || "");

  const resetSteps = (message = null) => {
    setStep(null);
    setStepCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPendingLogin(null);
    setError(message);
  };

  const stepErrorMessage = (stepError) =>
    stepError?.status === 401
      ? { key: "access.security.stepExpired" }
      : stepError?.message
        ? { text: stepError.message }
        : { key: "access.security.unknown" };

  const loginErrorMessage = (loginError) => {
    const status = Number(loginError?.status || 0);
    const serverMessage = String(loginError?.responseBody?.message || loginError?.message || "");
    if (!status) return { key: "common.login.errors.network" };
    if (status >= 500) return { key: "common.login.errors.server" };
    if (/invalid email or password/i.test(serverMessage)) return { key: "common.login.errors.invalid" };
    if (/account disabled/i.test(serverMessage)) return { key: "common.login.errors.disabled" };
    if (/email and password required/i.test(serverMessage)) return { key: "common.login.errors.missing" };
    return serverMessage ? { text: serverMessage } : { key: "common.login.errors.server" };
  };

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

    // The language the person signed in with carries into the app, unless they
    // (or their account) already chose one.
    if (!getStoredLanguage()) persistApplicationLanguage(language);

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
      setError(null);
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
      setError({ key: "access.security.passwordsMismatch" });
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await api.post("/auth/login/password-change", {
        challenge_token: step.challenge_token,
        current_password: password,
        new_password: newPassword,
      });
      resetSteps();
      setPassword("");
      setNotice({ key: "access.security.passwordChanged" });
    } catch (stepError) {
      if (stepError?.status === 401) resetSteps(stepErrorMessage(stepError));
      else setError(stepErrorMessage(stepError));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (lockedSeconds > 0) return;

    try {
      setLoading(true);
      setError(null);
      setNotice(null);

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
      if (loginError?.status === 429) {
        const seconds = Number(loginError?.responseBody?.retry_after_seconds) || 60;
        const at = Date.now();
        setNow(at);
        setLock({ until: at + seconds * 1000, email: email.trim().toLowerCase() });
        return;
      }

      if (/workspace required/i.test(String(loginError?.responseBody?.message || loginError?.message || ""))) {
        // Asked again with a code already typed: that code matched no company.
        if (showWorkspace && workspace.trim()) setError({ key: "common.login.errors.workspaceUnknown" });
        setShowWorkspace(true);
        return;
      }

      setError(loginErrorMessage(loginError));
    } finally {
      setLoading(false);
    }
  };

  const messages = (
    <>
      {lockedSeconds > 0 ? (
        <div className="m1-login__alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            {t("common.login.errors.locked", { time: "⁨" + formatCountdown(lockedSeconds) + "⁩" })}
          </span>
        </div>
      ) : error ? (
        <div className="m1-login__alert" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{messageText(error)}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="m1-login__alert m1-login__alert--success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{messageText(notice)}</span>
        </div>
      ) : null}
    </>
  );

  const layout = (content) => (
    <div className="m1-login">
      <aside className="m1-login__brand">
        <div className="m1-login__brand-inner">
          <BrandLogo key={brandLogo} name={brandName} logoUrl={brandLogo} size={148} />
          <p className="m1-login__brand-name">{brandName}</p>
          {brand.tagline ? <p className="m1-login__brand-tagline">{brand.tagline}</p> : null}
        </div>
      </aside>

      <main className="m1-login__main">
        <div className="m1-login__top">
          <div className="m1-login__lang" role="group" aria-label={t("language.label")}>
            {LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                lang={code}
                aria-pressed={language === code}
                title={t(code === "ar" ? "language.arabic" : "language.english")}
                onClick={() => (language === code ? null : changeLanguage(code, { persist: true }))}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="m1-login__body">
          <div className="m1-login__mobile-brand">
            <BrandLogo key={brandLogo} name={brandName} logoUrl={brandLogo} size={72} />
            <p>{brandName}</p>
          </div>
          {content}
        </div>

        {buildId ? (
          <footer className="m1-login__foot">
            <span>{t("common.login.version", { build: buildId })}</span>
          </footer>
        ) : null}
      </main>
    </div>
  );

  const stepLayout = (title, help, body) =>
    layout(
      <>
        <h1 className="m1-login__title">{title}</h1>
        {help ? <p className="m1-login__help-text">{help}</p> : null}
        {body}
        {messages}
        {!pendingLogin ? (
          <button type="button" onClick={() => resetSteps()} className="m1-login__link">
            {t("access.security.backToLogin")}
          </button>
        ) : null}
      </>
    );

  if (pendingLogin) {
    return stepLayout(
      t("access.security.loginEnrollTitle"),
      null,
      <RecoveryCodesList codes={pendingLogin.recovery_codes || []} onDone={() => completeLogin(pendingLogin)} />
    );
  }

  if (step?.step === "mfa_required") {
    return stepLayout(
      t("access.security.loginMfaTitle"),
      t("access.security.loginMfaHelp"),
      <form onSubmit={submitMfaCode}>
        <div className="m1-login__field">
          <input
            type="text"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            dir="ltr"
            maxLength={11}
            placeholder={t("access.security.codeOrRecovery")}
            aria-label={t("access.security.codeOrRecovery")}
            value={stepCode}
            onChange={(event) => setStepCode(event.target.value)}
            className="m1-login__input m1-login__input--code"
          />
        </div>
        <button type="submit" disabled={loading || stepCode.trim().length < 6} className="m1-login__submit">
          {loading ? <Loader2 size={18} className="m1-login__spin" aria-hidden="true" /> : null}
          {t("access.security.confirm")}
        </button>
      </form>
    );
  }

  if (step?.step === "mfa_enrollment_required") {
    return stepLayout(
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
    return stepLayout(
      t("access.security.loginPasswordTitle"),
      t("access.security.loginPasswordHelp"),
      <form onSubmit={submitPasswordChange}>
        {reasons.length ? (
          <ul className="m1-login__alert m1-login__alert--list">
            {reasons.map((reason) => <li key={reason}>{t(`access.security.${reasonLabel[reason] || "unknown"}`)}</li>)}
          </ul>
        ) : null}
        <p className="m1-login__hint m1-login__policy">{t("access.security.passwordPolicy")}</p>
        <PasswordField
          id="login-new-password"
          label={t("access.security.newPassword")}
          autoComplete="new-password"
          autoFocus
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <PasswordField
          id="login-confirm-password"
          label={t("access.security.confirmPassword")}
          autoComplete="new-password"
          value={confirmNewPassword}
          onChange={(event) => setConfirmNewPassword(event.target.value)}
        />
        <button type="submit" disabled={loading || !newPassword} className="m1-login__submit">
          {loading ? <Loader2 size={18} className="m1-login__spin" aria-hidden="true" /> : null}
          {t("access.security.changePassword")}
        </button>
      </form>
    );
  }

  return layout(
    <form onSubmit={handleLogin}>
      <h1 className="m1-login__title">{t("common.login.title")}</h1>

      <div className="m1-login__field">
        <label htmlFor="login-email" className="m1-login__label">{t("common.login.email")}</label>
        <input
          id="login-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="m1-login__input"
        />
      </div>

      <PasswordField
        id="login-password"
        label={t("common.login.password")}
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {showWorkspace ? (
        <div className="m1-login__field">
          <label htmlFor="login-workspace" className="m1-login__label">{t("common.login.workspace")}</label>
          <input
            ref={workspaceRef}
            id="login-workspace"
            type="text"
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            className="m1-login__input"
          />
          <p className="m1-login__hint">{t("common.login.workspaceHint")}</p>
        </div>
      ) : null}

      <button type="submit" disabled={loading || lockedSeconds > 0} className="m1-login__submit">
        {loading ? <Loader2 size={18} className="m1-login__spin" aria-hidden="true" /> : null}
        {loading ? t("common.login.submitting") : t("common.login.submit")}
      </button>

      {messages}

      <p className="m1-login__forgot">{t("common.login.forgot")}</p>
    </form>
  );
}

export default Login;
