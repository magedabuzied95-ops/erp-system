import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CircleCheckBig, MapPin, RefreshCcw, ScanLine, ShieldAlert } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";

import { scanQrAttendance } from "../attendanceApi";
import { getAttendanceDeviceFingerprint, getAttendanceDeviceToken } from "../attendanceDevice";

const getCurrentPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS is not available on this device"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  });

const formatDateTime = (value) => {
  if (!value) return "-";
  let date;
  try {
    date = value instanceof Date ? value : new Date(value);
  } catch {
    return "-";
  }
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatDistance = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const meters = Number(value);
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};

export default function StaffQrAttendance() {
  const [scannerVersion, setScannerVersion] = useState(0);
  const [isScanning, setIsScanning] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const scannerRef = useRef(null);
  const lockRef = useRef(false);

  const scannerId = useMemo(() => `qr-attendance-reader-${scannerVersion}`, [scannerVersion]);

  useEffect(() => {
    if (!isScanning) return undefined;

    let active = true;

    const startScanner = async () => {
      try {
        const scanner = new Html5QrcodeScanner(
          scannerId,
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            rememberLastUsedCamera: true,
            showTorchButtonIfSupported: true,
            showZoomSliderIfSupported: true,
          },
          false
        );

        scannerRef.current = scanner;

        scanner.render(
          async (decodedText) => {
            if (lockRef.current || !active) return;
            lockRef.current = true;
            setProcessing(true);
            setError("");

            try {
              const position = await getCurrentPosition();
              const response = await scanQrAttendance({
                qrToken: String(decodedText || "").trim(),
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                device_token: getAttendanceDeviceToken(),
                device_fingerprint: getAttendanceDeviceFingerprint(),
              });

              setResult({
                ...response,
                action: response?.action || response?.data?.status || "checked_in",
              });
              setIsScanning(false);
              await scanner.clear();
              setProcessing(false);
              const portalUrl = response?.portal_url || response?.employee_portal?.url;
              if (response?.action === "check_in" && response?.employee_portal?.auto_redirect !== false && portalUrl) {
                window.location.assign(portalUrl);
              }
            } catch (scanError) {
              const message =
                scanError?.responseBody?.message ||
                scanError?.message ||
                "Failed to record attendance";
              setError(message);
              lockRef.current = false;
              setProcessing(false);
            }
          },
          () => {}
        );
      } catch (scannerError) {
        setError(scannerError?.message || "Unable to start the camera scanner");
        setProcessing(false);
      }
    };

    startScanner();

    return () => {
      active = false;
      lockRef.current = false;
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [isScanning, scannerId]);

  const record = result?.data || null;
  const action = String(result?.action || record?.status || "").toLowerCase();
  const isCheckout = action === "checked_out" || action === "check_out";
  const eventTime = isCheckout ? record?.check_out_at || record?.check_out : record?.check_in_at || record?.check_in;

  const restartScanner = () => {
    setError("");
    setResult(null);
    setProcessing(false);
    lockRef.current = false;
    setScannerVersion((value) => value + 1);
    setIsScanning(true);
  };

  return (
    <div className="min-h-full bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                <ScanLine className="h-3.5 w-3.5" />
                Staff QR attendance
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">Scan branch QR, then confirm GPS</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                The scanner only records attendance when the QR token matches a configured branch and the device is inside that branch radius.
              </p>
            </div>
            <button
              type="button"
              onClick={restartScanner}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <RefreshCcw className={`h-4 w-4 ${processing ? "animate-spin" : ""}`} />
              Scan again
            </button>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Camera className="h-4 w-4" />
              Camera scanner
            </div>
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 p-3">
              {isScanning ? (
                <div id={scannerId} className="overflow-hidden rounded-2xl" />
              ) : (
                <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 px-6 py-10 text-center">
                  <CircleCheckBig className="h-12 w-12 text-emerald-300" />
                  <div className="mt-4 text-xl font-black text-white">
                    {isCheckout ? "Check out recorded" : "Check in recorded"}
                  </div>
                  <div className="mt-2 text-sm text-slate-300">{record?.employee_name || "Attendance saved successfully"}</div>
                  <button
                    type="button"
                    onClick={restartScanner}
                    className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
                  >
                    <ScanLine className="h-4 w-4" />
                    Scan next badge
                  </button>
                </div>
              )}
            </div>
            {processing ? <div className="mt-4 text-sm text-primary">Processing QR and GPS location...</div> : null}
            {error ? <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
          </section>

          <aside className="flex flex-col gap-4">
            {record ? (
              <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                  <CircleCheckBig className="h-4 w-4 text-emerald-300" />
                  Latest result
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Result</div>
                  <div className="mt-1 text-2xl font-black text-white">
                      {isCheckout ? "Check out recorded" : "Check in recorded"}
                  </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <InfoRow label="Employee" value={record.employee_name || "-"} />
                    <InfoRow label="Branch" value={record.branch_name || "-"} />
                    <InfoRow label="Time" value={formatDateTime(eventTime)} />
                    <InfoRow label="Distance" value={formatDistance(result?.distanceMeters)} />
                    <InfoRow label="Allowed radius" value={formatDistance(result?.allowedRadiusMeters)} />
                  </div>
                </div>
              </section>
            ) : null}

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <MapPin className="h-4 w-4" />
                Validation rules
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <Rule text="QR token must match a configured branch." />
                <Rule text="GPS coordinates must be inside the branch radius." />
                <Rule text="First valid scan creates check in." />
                <Rule text="Second valid scan closes the day with check out." />
                <Rule text="Further scans after checkout are rejected." />
              </div>
            </section>

            <section className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-5 shadow-2xl shadow-black/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                <ShieldAlert className="h-4 w-4" />
                GPS note
              </div>
              <p className="mt-3 text-sm leading-6 text-amber-50/90">
                Permission for location is requested only after a QR code is decoded. If GPS is denied or the device is outside the branch radius, the scan is rejected.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Rule({ text }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-3">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
      <span>{text}</span>
    </div>
  );
}
