import { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";

import "./i18n/i18n";

import "./index.css";
import "./theme/foundation.css";
import "./theme/fonts-alexandria.css";
import "./theme/reference.css";
import { API_BASE_URL, API_ORIGIN, SOCKET_URL } from "./shared/constants/app.js?m1PreviewApi=2";
import { importWithChunkRetry, installChunkLoadRecovery, installStylesheetRecovery, recoverFromChunkLoadError } from "./shared/utils/chunkLoadRecovery";
import { installDayFirstDateInputs } from "./shared/utils/dateInputLocale";
import { installNumericZeroSelect } from "./shared/utils/numericInputZero";
import { installAppTimezoneDefaults } from "./shared/lib/appTimezone";
import { lockPortalViewport } from "./shared/utils/portalViewportLock";
import { ThemeProvider } from "./theme/ThemeProvider";

import { BrowserRouter, Route, Routes } from "react-router-dom";

/* ======================================================
   TOAST
====================================================== */

import LocalizedToaster from "./shared/components/LocalizedToaster.jsx";
import MetaPageTracker from "./shared/components/MetaPageTracker.jsx";

const clearStaleApiOverrides = () => {
  if (typeof window === "undefined") return;

  const overrideKeyPattern = /(api|backend|baseurl|base_url|origin|socket|websocket|ws|host|cloudflare)/i;
  const currentOrigin = window.location.origin;
  const cloudflarePattern = /\.trycloudflare\.com/i;
  const currentCloudflareHost = (() => {
    try {
      return new URL(currentOrigin).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  const shouldClearStorageEntry = (key = "", value = "") => {
    const raw = String(value || "");
    if (!overrideKeyPattern.test(key)) return false;

    if (cloudflarePattern.test(raw)) {
      if (!currentCloudflareHost.endsWith(".trycloudflare.com")) return true;
      try {
        return new URL(raw, currentOrigin).hostname.toLowerCase() !== currentCloudflareHost;
      } catch {
        return true;
      }
    }

    return false;
  };

  [window.localStorage, window.sessionStorage].forEach((storage) => {
    if (!storage) return;

    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (!key) continue;

        const value = storage.getItem(key) || "";
        if (shouldClearStorageEntry(key, value)) {
          storage.removeItem(key);
        }
      }
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  });
};

clearStaleApiOverrides();
installChunkLoadRecovery();
installStylesheetRecovery();
// Before the first render: every clock on screen reads the store's zone, not the device's.
installAppTimezoneDefaults();
installDayFirstDateInputs();
installNumericZeroSelect();


if (import.meta.env.DEV) {
  console.debug("[runtime] resolved URLs", {
    apiBaseUrl: API_BASE_URL,
    apiOrigin: API_ORIGIN,
    socketUrl: SOCKET_URL,
    windowOrigin: typeof window !== "undefined" ? window.location.origin : "",
  });
}

if (typeof document !== "undefined") {
  try {
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = localStorage.getItem("erp.theme") === "dark" ? "dark" : "light";
    }
  } catch {
    if (!document.documentElement.dataset.theme) document.documentElement.dataset.theme = "light";
  }
}

const root = ReactDOM.createRoot(document.getElementById("root"));
const isEmployeeAppRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/employee-app/");

if (isEmployeeAppRoute) {
  // The installed employee app never mounts App.jsx — this table IS its router. A page
  // added to App.jsx's /employee-app block must be added here too: الشحن was missing
  // (2026-09-11) and fell through to the home below, so the tab "did nothing".
  // الشحن is lazy (the home prefetches it once idle) so the board never weighs on the boot.
  //
  // For the same reason the viewport lock is taken here and never released: App.jsx
  // holds it per route, but this root is the portal from boot to close, and it is the
  // copy on the staff's home screens — the one that was magnifying on every tap into
  // the chat composer. Taken before the first render so no field can be focused first.
  lockPortalViewport();
  const EmployeePortalOnlineOrders = lazy(() => importWithChunkRetry(() => import("./modules/employees/pages/EmployeePortalOnlineOrders.jsx")));
  const EmployeePortalInbox = lazy(() => importWithChunkRetry(() => import("./modules/employees/pages/EmployeePortalInbox.jsx")));
  Promise.all([
    import("./modules/employees/pages/EmployeeAppShell.jsx"),
    import("./modules/employees/pages/EmployeePortalProducts.jsx"),
    import("./modules/employees/pages/EmployeePortalInventory.jsx"),
    import("./shared/components/PortalUpdateWatcher.jsx"),
  ]).then(([
    { default: EmployeeAppShell },
    { default: EmployeePortalProducts },
    { default: EmployeePortalInventory },
    { default: PortalUpdateWatcher },
  ]) => {
    root.render(
      <ThemeProvider>
        <BrowserRouter>
          <PortalUpdateWatcher />
          <Routes>
            <Route path="/employee-app/:token/products" element={<EmployeePortalProducts />} />
            <Route path="/employee-app/:token/inventory" element={<EmployeePortalInventory />} />
            <Route path="/employee-app/:token/inventory/:sessionId" element={<EmployeePortalInventory />} />
            <Route path="/employee-app/:token/online-orders" element={<Suspense fallback={null}><EmployeePortalOnlineOrders /></Suspense>} />
            <Route path="/employee-app/:token/inbox" element={<Suspense fallback={null}><EmployeePortalInbox /></Suspense>} />
            <Route path="/employee-app/:token/inbox/:conversationId" element={<Suspense fallback={null}><EmployeePortalInbox /></Suspense>} />
            <Route path="/employee-app/:token" element={<EmployeeAppShell />} />
            <Route path="/employee-app/*" element={<EmployeeAppShell />} />
          </Routes>
          <LocalizedToaster />
        </BrowserRouter>
      </ThemeProvider>
    );
  });
} else {
  // A dead page with no way out is the one outcome not allowed here. index.html owns
  // the refresh screen (its copy is bilingual and it already reads the stored
  // language before i18n exists); the bare fallback below only covers a document
  // that somehow lacks that script.
  const showBootFailure = () => {
    if (typeof window !== "undefined" && typeof window.__m1ShowBootFailure === "function") {
      window.__m1ShowBootFailure();
      return;
    }
    root.render(
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 24px", borderRadius: 12, font: "inherit" }}>
          Reload
        </button>
      </div>
    );
  };

  // App.jsx is a chunk like any other, so it gets the same retry past a CDN-cached 404
  // before anything reloads. recover:false because the recovery runs below, where its
  // answer decides whether a reload is coming or the refresh screen has to show.
  importWithChunkRetry(() => import("./App.jsx"), { recover: false })
    .then(({ default: App }) => {
      root.render(
        <ThemeProvider>
          <BrowserRouter>
            <MetaPageTracker />

            {/* ======================================================
               APP
            ====================================================== */}

            <App />

            {/* ======================================================
               TOASTER
            ====================================================== */}

            <LocalizedToaster />

          </BrowserRouter>
        </ThemeProvider>
      );
    })
    .catch((error) => {
      // False means no reload is on its way: the guard was already spent, the origin
      // is unreachable, or this was not a chunk error at all. Each used to leave a
      // blank page.
      recoverFromChunkLoadError(error).then((reloading) => {
        if (!reloading) showBootFailure();
      }, showBootFailure);
    });
}
