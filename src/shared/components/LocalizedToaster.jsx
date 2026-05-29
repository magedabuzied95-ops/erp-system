import { Toaster } from "react-hot-toast";

import { useLocale } from "../lib/locale";

function LocalizedToaster() {
  const { dir, isRtl } = useLocale();

  return (
    <Toaster
      position={isRtl ? "top-left" : "top-right"}
      reverseOrder={false}
      toastOptions={{
        duration: 3000,
        style: {
          direction: dir,
          textAlign: isRtl ? "right" : "left",
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "18px",
          padding: "16px",
          fontWeight: "700",
          fontFamily: "var(--app-font)",
        },
        success: {
          iconTheme: {
            primary: "var(--success)",
            secondary: "var(--text)",
          },
        },
        error: {
          iconTheme: {
            primary: "var(--danger)",
            secondary: "var(--text)",
          },
        },
      }}
    />
  );
}

export default LocalizedToaster;
