import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, MessageCircleMore } from "lucide-react";

import { useEmployeePortalArabic } from "../lib/employeePortalLanguage";
import EmployeePortalNavControls, { buildEmployeePortalHomePath } from "../components/EmployeePortalNavControls";
import { openEmployeePortalInboxSession } from "../services/employeePortalInboxApi";
import { clearAuthSessionOverride, setAuthSessionOverride } from "../../../shared/auth/authStorage";
import usePageTitle from "../../../shared/hooks/usePageTitle";

const AiInboxPwa = lazy(() => import("../../aiSupport/pages/AiInboxPwa"));

// الرسائل in the employee portal: the /inbox PWA without comments, for employees the
// admin switched on. The page borrows a confined inbox session minted from the
// portal link and keeps it in memory only (see setAuthSessionOverride).
export default function EmployeePortalInbox() {
  const { t } = useEmployeePortalArabic();
  usePageTitle("Employee Messages");
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: "opening", message: "" });
  const mintingRef = useRef(false);
  const readyRef = useRef(false);

  const homePath = buildEmployeePortalHomePath({ pathname: window.location.pathname, token });
  const basePath = `${homePath}/inbox`;

  const openSession = useCallback(async () => {
    if (mintingRef.current) return;
    mintingRef.current = true;
    readyRef.current = false;
    setState({ status: "opening", message: "" });
    try {
      const response = await openEmployeePortalInboxSession(token);
      if (!response?.token) throw new Error("");
      setAuthSessionOverride({ token: response.token, user: response.user });
      readyRef.current = true;
      setState({ status: "ready", message: "" });
    } catch (error) {
      const disabled = error?.status === 403 || error?.responseBody?.code === "PORTAL_INBOX_DISABLED";
      setState({ status: disabled ? "disabled" : "failed", message: disabled ? "" : error?.message || "" });
    } finally {
      mintingRef.current = false;
    }
  }, [token]);

  useEffect(() => {
    void openSession();
    return () => {
      readyRef.current = false;
      clearAuthSessionOverride();
    };
  }, [openSession]);

  // The borrowed session ended (expired, link renewed, access closed): mint again.
  // A switched-off employee lands on the "not enabled" screen from there.
  useEffect(() => {
    const onAuthUser = (event) => {
      if (readyRef.current && !event?.detail?.user) void openSession();
    };
    window.addEventListener("erp:auth-user-updated", onAuthUser);
    return () => window.removeEventListener("erp:auth-user-updated", onAuthUser);
  }, [openSession]);

  const portal = useMemo(() => ({ basePath, homePath }), [basePath, homePath]);

  if (state.status === "ready") {
    return (
      <Suspense fallback={<OpeningScreen label={t("employeePortal.messages.opening")} />}>
        <AiInboxPwa portal={portal} />
      </Suspense>
    );
  }

  if (state.status === "opening") return <OpeningScreen label={t("employeePortal.messages.opening")} />;

  return (
    <main className="employee-portal-min-screen employee-portal-safe-top min-h-[100dvh] bg-background px-3 py-3 text-text">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <EmployeePortalNavControls onBack={() => navigate(homePath, { replace: true })} onHome={() => navigate(homePath)} className="px-0" />
        <section className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center shadow-sm">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-muted text-text-muted">
            <MessageCircleMore className="h-6 w-6" />
          </span>
          <h1 className="m1-section-title text-text">
            {state.status === "disabled" ? t("employeePortal.messages.disabledTitle") : t("employeePortal.messages.failedTitle")}
          </h1>
          <p className="text-sm text-text-muted">
            {state.status === "disabled" ? t("employeePortal.messages.disabledHint") : state.message}
          </p>
          {state.status === "failed" ? (
            <button
              type="button"
              onClick={() => void openSession()}
              className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] bg-primary px-5 text-sm font-black text-primary-foreground"
            >
              {t("employeePortal.messages.retry")}
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function OpeningScreen({ label }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background text-text-muted">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Loader2 className="h-5 w-5 animate-spin" />
        {label}
      </div>
    </main>
  );
}
