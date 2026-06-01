import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import EmployeePayrollPortal from "./EmployeePayrollPortal";

export default function EmployeeAppShell() {
  const { token } = useParams();
  const [debugInfo, setDebugInfo] = useState({
    href: "",
    manifestHref: "",
    manifestCount: 0,
    manifestStartUrl: "",
    manifestScope: "",
    standalone: false,
    employeePortalLastUrl: "",
    apiDebugUrl: "",
  });

  useEffect(() => {
    console.debug("[employee-app-route-hit]", token);
  }, [token]);

  useEffect(() => {
    const readDebugInfo = async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const manifestHref = manifestLink?.href || "";
      let manifestStartUrl = "";
      let manifestScope = "";
      try {
        if (manifestHref) {
          const response = await fetch(manifestHref, { cache: "no-store" });
          const manifest = await response.json();
          manifestStartUrl = manifest.start_url || "";
          manifestScope = manifest.scope || "";
        }
      } catch (error) {
        console.warn("[employee-app-pwa-debug] manifest read failed", error);
      }

      const standalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
      const employeePortalLastUrl = window.localStorage?.getItem("employee_portal_last_url") || "";
      const apiDebugUrl = `/api/debug/pwa?currentPath=${encodeURIComponent(
        window.location.pathname + window.location.search
      )}&manifestHref=${encodeURIComponent(manifestHref)}&manifestStartUrl=${encodeURIComponent(
        manifestStartUrl
      )}&manifestScope=${encodeURIComponent(manifestScope)}&standalone=${encodeURIComponent(
        String(standalone)
      )}&employeePortalLastUrl=${encodeURIComponent(employeePortalLastUrl)}`;

      setDebugInfo({
        href: window.location.href,
        manifestHref,
        manifestCount: document.querySelectorAll('link[rel="manifest"]').length,
        manifestStartUrl,
        manifestScope,
        standalone,
        employeePortalLastUrl,
        apiDebugUrl,
      });
    };

    readDebugInfo();
    const timer = window.setTimeout(readDebugInfo, 500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <div
        dir="ltr"
        style={{
          position: "fixed",
          top: "max(8px, env(safe-area-inset-top))",
          left: 8,
          right: 8,
          zIndex: 99999,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(15, 23, 42, 0.92)",
          color: "#fff",
          fontSize: 11,
          lineHeight: 1.5,
          overflowWrap: "anywhere",
        }}
      >
        <div>window.location.href: {debugInfo.href}</div>
        <div>manifest href: {debugInfo.manifestHref}</div>
        <div>manifest count: {debugInfo.manifestCount}</div>
        <div>manifest start_url: {debugInfo.manifestStartUrl}</div>
        <div>manifest scope: {debugInfo.manifestScope}</div>
        <div>standalone: {String(debugInfo.standalone)}</div>
        <div>employee_portal_last_url: {debugInfo.employeePortalLastUrl}</div>
        <div>debug api: {debugInfo.apiDebugUrl}</div>
      </div>
      <EmployeePayrollPortal appMode="employee-pwa" />
    </>
  );
}
