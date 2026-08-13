import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../shared/api/api";
import { setAuth, getCurrentTenant, setCurrentTenant } from "../shared/auth/authStorage";
import { API_BASE_URL } from "../shared/constants/app.js?m1PreviewApi=2";

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
  const brandLogo =
    publicSettings?.["general.company_logo_url"] ||
    publicSettings?.["storefront.store_logo_url"] ||
    "";
  const brandInitials =
    String(brandName || "MONE")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "MONE";

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");

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

      const role = String(data?.user?.role || data?.user?.role_name || "").toLowerCase();
      window.location.href = data?.user?.account_mode === "meta_reviewer" || role === "meta_reviewer" ? "/admin/ai-inbox" : "/dashboard";
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

        {error ? (
          <p className="mt-4 text-center text-[var(--danger)]">{error}</p>
        ) : null}
      </form>
    </div>
  );
}

export default Login;
