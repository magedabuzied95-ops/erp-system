import ReactDOM from "react-dom/client";

import App from "./App.jsx";
import "./i18n/i18n";

import "./index.css";
import { ThemeProvider } from "./theme/ThemeProvider";

import {
  BrowserRouter
} from "react-router-dom";

/* ======================================================
   TOAST
====================================================== */

import {
  Toaster
} from "react-hot-toast";

if (typeof document !== "undefined") {
  document.documentElement.dataset.theme = localStorage.getItem("erp.theme") || "dark";
}

ReactDOM.createRoot(

  document.getElementById("root")

).render(

  <ThemeProvider>
    <BrowserRouter>

      {/* ======================================================
         APP
      ====================================================== */}

      <App />

      {/* ======================================================
         TOASTER
      ====================================================== */}

      <Toaster
        position="top-right"
        reverseOrder={false}
        toastOptions={{
          duration: 3000,
          style: {
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: "18px",
            padding: "16px",
            fontWeight: "700"
          },
          success: {
            iconTheme: {
              primary: "var(--success)",
              secondary: "var(--text)"
            }
          },
          error: {
            iconTheme: {
              primary: "var(--danger)",
              secondary: "var(--text)"
            }
          }
        }}
      />

    </BrowserRouter>
  </ThemeProvider>
);
