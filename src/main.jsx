import ReactDOM from "react-dom/client";

import "./i18n/i18n";

import "./index.css";
import "./theme/foundation.css";
import { API_BASE_URL, API_ORIGIN, SOCKET_URL } from "./shared/constants/app.js?m1PreviewApi=2";
import { installChunkLoadRecovery } from "./shared/utils/chunkLoadRecovery";
import { ThemeProvider } from "./theme/ThemeProvider";

import { BrowserRouter, Route, Routes } from "react-router-dom";

/* ======================================================
   TOAST
====================================================== */

import LocalizedToaster from "./shared/components/LocalizedToaster.jsx";

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
    document.documentElement.dataset.theme = localStorage.getItem("erp.theme") || "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
}

const root = ReactDOM.createRoot(document.getElementById("root"));
const isEmployeeAppRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/employee-app/");

if (isEmployeeAppRoute) {
  import("./modules/employees/pages/EmployeeAppShell.jsx").then(({ default: EmployeeAppShell }) => {
    root.render(
      <BrowserRouter>
        <Routes>
          <Route path="/employee-app/:token" element={<EmployeeAppShell />} />
          <Route path="/employee-app/*" element={<EmployeeAppShell />} />
        </Routes>
      </BrowserRouter>
    );
  });
} else {
  import("./App.jsx").then(({ default: App }) => {
    root.render(
      <ThemeProvider>
        <BrowserRouter>

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
  });
}
