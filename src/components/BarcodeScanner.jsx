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

const safeStopScanner = (scanner) => {
  try {
    const stopResult = scanner?.stop?.();
    if (stopResult && typeof stopResult.catch === "function") {
      return stopResult.catch((error) => {
        console.warn("[barcode-scanner:stop-failed]", error);
      });
    }
    return stopResult;
  } catch (error) {
    console.warn("[barcode-scanner:stop-threw]", error);
    return undefined;
  }
};

const safeClearScanner = (scanner) => {
  try {
    const clearResult = scanner?.clear?.();
    if (clearResult && typeof clearResult.catch === "function") {
      clearResult.catch((error) => {
        console.warn("[barcode-scanner:clear-failed]", error);
      });
    }
  } catch (error) {
    console.warn("[barcode-scanner:clear-threw]", error);
  }
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
      console.log("[SCANNER_ENV]", {
        isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
        mediaDevices: typeof navigator !== "undefined" ? !!navigator.mediaDevices : false,
        getUserMedia: typeof navigator !== "undefined" ? !!navigator.mediaDevices?.getUserMedia : false,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      });
      console.error("[SCANNER_UNSUPPORTED_BROWSER]", {
        reason: "Camera APIs unavailable or insecure context",
      });
      onUnsupported?.(CAMERA_UNSUPPORTED_MESSAGE);
      return undefined;
    }

    let active = true;

    const startScanner = async () => {
      try {
        console.log("[SCANNER_ENV]", {
          isSecureContext: window.isSecureContext,
          mediaDevices: !!navigator.mediaDevices,
          getUserMedia: !!navigator.mediaDevices?.getUserMedia,
          userAgent: navigator.userAgent,
        });
        const container = typeof document !== "undefined" ? document.getElementById(scannerId) : null;
        if (!container) {
          console.error("[SCANNER_CONTAINER_NOT_FOUND]", { scannerId });
          onError?.(CAMERA_START_FAILED_MESSAGE);
          return;
        }
        console.log("[SCANNER_INIT_START]");
        const scanner = new Html5Qrcode(scannerId);
        console.log("[SCANNER_INSTANCE_CREATED]");
        html5QrCodeRef.current = scanner;

        const cameras = await Html5Qrcode.getCameras();
        console.log("[SCANNER_CAMERAS]", cameras);
        if (!Array.isArray(cameras) || cameras.length === 0) {
          console.error("[SCANNER_NO_CAMERAS_FOUND]", { cameras });
          onError?.(CAMERA_START_FAILED_MESSAGE);
          return;
        }

        const preferredCamera =
          cameras.find((camera) => /back|rear|environment/i.test(String(camera?.label || ""))) ||
          cameras[0] ||
          null;
        const cameraId = preferredCamera?.id || null;
        const facingMode = { ideal: "environment" };
        const fps = 10;
        const qrbox = { width: 240, height: 240 };

        console.log("[SCANNER_START_CONFIG]", {
          cameraId,
          facingMode,
          fps,
          qrbox,
        });

        try {
          await scanner.start(
            cameraId || { facingMode },
            {
              fps,
              qrbox,
              aspectRatio: 1,
              disableFlip: false,
            },
            async (decodedText) => {
              if (!active || handledRef.current) return;
              handledRef.current = true;
              try {
                await safeStopScanner(scanner);
              } catch {
                // Ignore stop errors during teardown.
              }
              startedRef.current = false;
              onScan?.(String(decodedText || "").trim());
            },
            () => {}
          );
        } catch (error) {
          console.error("[SCANNER_START_ERROR]", {
            error,
            name: error?.name,
            message: error?.message,
            stack: error?.stack,
          });
          throw error;
        }

        startedRef.current = true;
      } catch (error) {
        const classified = classifyCameraError(error);
        if (!active) return;
        if (classified.type === "permission") {
          console.error("[SCANNER_PERMISSION_DENIED]", {
            error,
            name: error?.name,
            message: error?.message,
          });
          onPermissionDenied?.(classified.message);
        } else if (classified.type === "unsupported") {
          console.error("[SCANNER_UNSUPPORTED_BROWSER]", {
            error,
            name: error?.name,
            message: error?.message,
          });
          onUnsupported?.(classified.message);
        } else {
          onError?.(classified.message);
        }
      }
    };

    startScanner();

    return () => {
      active = false;
      handledRef.current = false;
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      if (!scanner) return;

      const cleanup = startedRef.current ? safeStopScanner(scanner) : undefined;

      Promise.resolve(cleanup).finally(() => {
        startedRef.current = false;
        safeClearScanner(scanner);
      });
    };
  }, [onError, onPermissionDenied, onScan, onUnsupported, scannerId]);

  return (
    <div className={className}>
      <div id={scannerId} className={scannerClassName} />
    </div>
  );
}
