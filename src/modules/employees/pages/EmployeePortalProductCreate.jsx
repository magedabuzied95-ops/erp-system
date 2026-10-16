import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, PackagePlus } from "lucide-react";
import toast from "react-hot-toast";

import EmployeePortalNavControls, { buildEmployeePortalHomePath } from "../components/EmployeePortalNavControls";
import { openEmployeePortalProductSession } from "../services/employeePortalInventoryApi";
import { clearAuthSessionOverride, setAuthSessionOverride } from "../../../shared/auth/authStorage";
import { activateRuntimeLanguage } from "../../managerPortal/lib/portalLanguage";
import usePageTitle from "../../../shared/hooks/usePageTitle";

const CreateProduct = lazy(() => import("../../products/pages/CreateProduct"));

// إضافة منتج inside استلام بضاعة: the ERP's own Add Product page, unchanged, for
// an employee with no ERP login. The page borrows a session minted from the
// portal link (server: modules/productEntryPortal) that can only create a
// product; it lives in memory only (setAuthSessionOverride). The page's own
// employee + PIN step still records who entered the product.
//
// Laid out at desktop width on purpose (owner's ask): the phone shows the whole
// 1280px page and the employee pinches and pans across the wide parts.
// maximum-scale spelled out: WebKit otherwise may keep the portal's old cap.
const DESKTOP_VIEWPORT = "width=1280, minimum-scale=0.1, maximum-scale=5, user-scalable=yes";

const useDesktopViewport = () => {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const meta = document.querySelector('meta[name="viewport"]');
    const original = meta ? meta.getAttribute("content") || "" : "";
    // The portals pin touch-action through this flag to stop pinch zoom.
    const touchFlag = document.documentElement.getAttribute("data-portal-touch");
    if (meta) meta.setAttribute("content", DESKTOP_VIEWPORT);
    document.documentElement.removeAttribute("data-portal-touch");
    return () => {
      if (meta) meta.setAttribute("content", original);
      if (touchFlag !== null) document.documentElement.setAttribute("data-portal-touch", touchFlag);
    };
  }, []);
};

export default function EmployeePortalProductCreate() {
  usePageTitle("Add Product");
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: "opening", message: "" });
  const [employeeName, setEmployeeName] = useState("");
  const mintingRef = useRef(false);
  const readyRef = useRef(false);
  useDesktopViewport();

  const homePath = buildEmployeePortalHomePath({ pathname: window.location.pathname, token });
  const receiptPath = `${homePath}/stock-receipt`;

  // `quiet`: a re-mint while the form is open must not unmount it and lose
  // what the employee typed.
  const openSession = useCallback(async ({ quiet = false } = {}) => {
    if (mintingRef.current) return;
    mintingRef.current = true;
    if (!quiet) setState({ status: "opening", message: "" });
    try {
      // Arabic like the rest of the portal (the ERP page otherwise follows the
      // phone's / system language), switched before the page first paints.
      const [response] = await Promise.all([openEmployeePortalProductSession(token), activateRuntimeLanguage("ar")]);
      if (!response?.token) throw new Error("");
      setAuthSessionOverride({ token: response.token, user: response.user });
      readyRef.current = true;
      setEmployeeName(String(response.user?.name || ""));
      setState({ status: "ready", message: "" });
    } catch (error) {
      readyRef.current = false;
      setState({ status: "failed", message: error?.responseBody?.message || error?.message || "" });
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

  // The borrowed session ended (4h, or the portal link was renewed): mint again.
  useEffect(() => {
    const onAuthUser = (event) => {
      if (readyRef.current && !event?.detail?.user) void openSession({ quiet: true });
    };
    window.addEventListener("erp:auth-user-updated", onAuthUser);
    return () => window.removeEventListener("erp:auth-user-updated", onAuthUser);
  }, [openSession]);

  const portal = useMemo(() => ({
    backHref: receiptPath,
    // Who the product is recorded under: the portal's own employee, so the page
    // skips its name + PIN step (the server takes it from the session).
    employeeName,
    // Back to استلام بضاعة with a fresh catalogue, so the new model is
    // searchable straight away.
    onCreated: () => {
      toast.success("المنتج اتضاف — دوّر عليه وضيف الكميات");
      navigate(receiptPath, { replace: true, state: { refreshCatalog: true } });
    },
  }), [navigate, receiptPath, employeeName]);

  if (state.status === "ready") {
    return (
      <div className="min-h-[100dvh] bg-background">
        <Suspense fallback={<OpeningScreen />}>
          <CreateProduct portal={portal} />
        </Suspense>
      </div>
    );
  }

  if (state.status === "opening") return <OpeningScreen />;

  return (
    <main className="min-h-[100dvh] bg-background px-3 py-3 text-text">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <EmployeePortalNavControls onBack={() => navigate(receiptPath, { replace: true })} onHome={() => navigate(homePath)} className="px-0" />
        <section className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center shadow-sm">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-soft text-text-muted">
            <PackagePlus className="h-6 w-6" />
          </span>
          <h1 className="m1-section-title text-text">تعذر فتح إضافة المنتج</h1>
          {state.message ? <p className="text-sm text-text-muted">{state.message}</p> : null}
          <button
            type="button"
            onClick={() => void openSession()}
            className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] bg-primary px-5 text-sm font-black text-[var(--primary-contrast)]"
          >
            جرّب تاني
          </button>
        </section>
      </div>
    </main>
  );
}

function OpeningScreen() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background text-text-muted">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Loader2 className="h-5 w-5 animate-spin" />
        بيفتح إضافة المنتج…
      </div>
    </main>
  );
}
