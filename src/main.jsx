import ReactDOM from "react-dom/client";

import "./i18n/i18n";

import "./index.css";
import "./theme/foundation.css";
import "./theme/fonts-alexandria.css";
import "./theme/reference.css";
import { API_BASE_URL, API_ORIGIN, SOCKET_URL } from "./shared/constants/app.js?m1PreviewApi=2";
import { installChunkLoadRecovery, installStylesheetRecovery, recoverFromChunkLoadError } from "./shared/utils/chunkLoadRecovery";
import { installDayFirstDateInputs } from "./shared/utils/dateInputLocale";
import { installNumericZeroSelect } from "./shared/utils/numericInputZero";
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
  Promise.all([
    import("./modules/employees/pages/EmployeeAppShell.jsx"),
    import("./modules/employees/pages/EmployeePortalProducts.jsx"),
    import("./modules/employees/pages/EmployeePortalInventory.jsx"),
  ]).then(([{ default: EmployeeAppShell }, { default: EmployeePortalProducts }, { default: EmployeePortalInventory }]) => {
    root.render(
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/employee-app/:token/products" element={<EmployeePortalProducts />} />
            <Route path="/employee-app/:token/inventory" element={<EmployeePortalInventory />} />
            <Route path="/employee-app/:token/inventory/:sessionId" element={<EmployeePortalInventory />} />
            <Route path="/employee-app/:token" element={<EmployeeAppShell />} />
            <Route path="/employee-app/*" element={<EmployeeAppShell />} />
          </Routes>
          <LocalizedToaster />
        </BrowserRouter>
      </ThemeProvider>
    );
  });
} else {
  import("./App.jsx")
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
      recoverFromChunkLoadError(error);
    });
}
