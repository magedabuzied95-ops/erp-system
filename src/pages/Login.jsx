import { useState } from "react";

import { api }
from "../shared/api/api";

import { setAuth }
from "../shared/auth/authStorage";
import { getCurrentTenant, setCurrentTenant } from "../shared/auth/authStorage";
import { API_BASE_URL } from "../shared/constants/app";

function Login() {

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [workspace, setWorkspace] =
    useState(
      getCurrentTenant()?.slug ||
      ""
    );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

 const handleLogin = async (e) => {

  e.preventDefault();

  try {

    setLoading(true);

    setError("");

    const loginUrl = `${API_BASE_URL}/auth/login`;
    console.log("[login] api base:", API_BASE_URL);
    console.log("[login] request url:", loginUrl);

    const data = await api.post(
      "/auth/login",
      {
        email,
        password,
        workspace,
        tenant_slug: workspace,
        tenant: workspace
      }
    );

    console.log(data);

    const tenant =
      data?.tenant ||
      data?.user?.tenant ||
      {
        id:
          data?.user?.tenant_id ||
          workspace ||
          "",
        slug:
          data?.user?.tenant_slug ||
          workspace ||
          "",
        name:
          data?.user?.tenant_name ||
          data?.user?.company_name ||
          workspace ||
          "Workspace",
        companyName:
          data?.user?.company_name ||
          data?.user?.tenant_name ||
          workspace ||
          "Workspace",
      };

    if (tenant?.id || tenant?.slug || tenant?.name) {
      setCurrentTenant(tenant);
    }

    setAuth({
      token: data.token,
      user: {
        ...data.user,
        tenant_id:
          data?.user?.tenant_id ||
          tenant?.id ||
          "",
        tenant_slug:
          data?.user?.tenant_slug ||
          tenant?.slug ||
          workspace ||
          "",
        tenant_name:
          data?.user?.tenant_name ||
          tenant?.name ||
          workspace ||
          "",
        company_name:
          data?.user?.company_name ||
          tenant?.companyName ||
          tenant?.name ||
          "",
      }
    });

    window.location.href =
      "/dashboard";

  } catch (error) {

    console.log(error);
    console.error("[login] fetch error details:", {
      message: error.message,
      stack: error.stack,
    });

    setError(error.message);

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

        <h1 className="mb-2 text-3xl font-bold text-center text-[var(--text)]">
          تسجيل الدخول
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--muted)]">
          سجّل دخولك إلى مساحة العمل
        </p>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
          className="mb-4 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />

        <input
          type="password"
          placeholder="كلمة المرور"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
          className="mb-4 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />

        <input
          type="text"
          placeholder="Workspace / company slug"
          value={workspace}
          onChange={(e) =>
            setWorkspace(e.target.value)
          }
          className="mb-4 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 font-semibold text-white"
        >

          {loading
            ? "جارٍ التحميل..."
            : "تسجيل الدخول"}

        </button>

        {error && (

          <p className="mt-4 text-center text-[var(--danger)]">
            {error}
          </p>
        )}

      </form>

    </div>
  );
}

export default Login;
