import { useEffect, useId, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

const CAMERA_PERMISSION_DENIED_MESSAGE = "تم رفض إذن الكاميرا. فعّل الكاميرا من إعدادات المتصفح ثم حاول مرة أخرى.";
const CAMERA_UNSUPPORTED_MESSAGE = "المتصفح أو الجهاز الحالي لا يدعم مسح الباركود أو QR بالكاميرا.";
const CAMERA_START_FAILED_MESSAGE = "تعذر تشغيل الكاميرا الآن. حاول مرة أخرى.";

const isCameraSupported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function";

const classifyCameraError = (error) => {
  const message = String(error?.message || error || "").toLowerCase();
  if (
    message.includes("notallowed") ||
    message.includes("permission") ||
    message.includes("denied") ||
    message.includes("access has been blocked")
  ) {
    return { type: "permission", message: CAMERA_PERMISSION_DENIED_MESSAGE };
  }
  if (
    message.includes("secure context") ||
    message.includes("not supported") ||
    message.includes("undefined") ||
    message.includes("notfound")
  ) {
    return { type: "unsupported", message: CAMERA_UNSUPPORTED_MESSAGE };
  }
  return { type: "error", message: CAMERA_START_FAILED_MESSAGE };
};

export const barcodeScannerMessages = {
  permissionDenied: CAMERA_PERMISSION_DENIED_MESSAGE,
  unsupported: CAMERA_UNSUPPORTED_MESSAGE,
  startFailed: CAMERA_START_FAILED_MESSAGE,
};

export default function BarcodeScanner({
  onScan,
  onPermissionDenied,
  onUnsupported,
  onError,
  className = "",
  scannerClassName = "",
}) {
  const scannerId = useId().replace(/:/g, "-");
  const html5QrCodeRef = useRef(null);
  const handledRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isCameraSupported()) {
      onUnsupported?.(CAMERA_UNSUPPORTED_MESSAGE);
      return undefined;
    }

    let active = true;

    const startScanner = async () => {
      try {
        const scanner = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: { ideal: "environment" } },
          {
            fps: 10,
            qrbox: { width: 240, height: 240 },
            aspectRatio: 1,
            disableFlip: false,
          },
          async (decodedText) => {
            if (!active || handledRef.current) return;
            handledRef.current = true;
            try {
              await scanner.stop();
            } catch {
              // Ignore stop errors during teardown.
            }
            startedRef.current = false;
            onScan?.(String(decodedText || "").trim());
          },
          () => {}
        );

        startedRef.current = true;
      } catch (error) {
        const classified = classifyCameraError(error);
        if (!active) return;
        if (classified.type === "permission") onPermissionDenied?.(classified.message);
        else if (classified.type === "unsupported") onUnsupported?.(classified.message);
        else onError?.(classified.message);
      }
    };

    startScanner();

    return () => {
      active = false;
      handledRef.current = false;
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      if (!scanner) return;

      const cleanup = startedRef.current
        ? scanner.stop().catch(() => {})
        : Promise.resolve();

      cleanup.finally(() => {
        startedRef.current = false;
        scanner.clear().catch(() => {});
      });
    };
  }, [onError, onPermissionDenied, onScan, onUnsupported, scannerId]);

  return (
    <div className={className}>
      <div id={scannerId} className={scannerClassName} />
    </div>
  );
}
