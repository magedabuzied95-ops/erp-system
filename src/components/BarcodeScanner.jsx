import { useEffect, useId, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

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

const hasBarcodeDetectorSupport = () =>
  typeof window !== "undefined" && typeof window.BarcodeDetector === "function";

const preferredBarcodeFormats = [
  "qr_code",
  "ean_13",
  "code_128",
  "code_39",
  "upc_a",
  "upc_e",
  "ean_8",
];

const supportedBarcodeFormats = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
];

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
  const nativeVideoRef = useRef(null);
  const nativeStreamRef = useRef(null);
  const nativeFrameRef = useRef(null);
  const detectorActiveRef = useRef(false);
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

    const handleDecodedValue = async (decodedText, stopCurrentScanner) => {
      if (!active || handledRef.current) return;
      handledRef.current = true;
      console.info("[employee-scanner]", String(decodedText || "").trim());
      try {
        await stopCurrentScanner?.();
      } catch {
        // Ignore teardown errors during handoff.
      }
      startedRef.current = false;
      onScan?.(String(decodedText || "").trim());
    };

    const stopNativeScanner = async () => {
      detectorActiveRef.current = false;
      if (nativeFrameRef.current) {
        window.cancelAnimationFrame(nativeFrameRef.current);
        nativeFrameRef.current = null;
      }
      const video = nativeVideoRef.current;
      if (video) {
        try {
          video.pause();
        } catch {
          // noop
        }
        video.srcObject = null;
        video.style.display = "none";
      }
      const stream = nativeStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      nativeStreamRef.current = null;
    };

    const startBarcodeDetectorScanner = async () => {
      if (!hasBarcodeDetectorSupport()) return false;
      const video = nativeVideoRef.current;
      if (!video) return false;

      let detector;
      try {
        const supportedFormats = typeof window.BarcodeDetector.getSupportedFormats === "function"
          ? await window.BarcodeDetector.getSupportedFormats()
          : [];
        const formats = preferredBarcodeFormats.filter((format) => supportedFormats.includes(format));
        detector = new window.BarcodeDetector({
          formats: formats.length ? formats : preferredBarcodeFormats,
        });
      } catch (error) {
        console.warn("[barcode-scanner:barcode-detector-init-failed]", error);
        return false;
      }

      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      nativeStreamRef.current = stream;
      video.srcObject = stream;
      video.style.display = "block";
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();

      detectorActiveRef.current = true;
      startedRef.current = true;

      const scanFrame = async () => {
        if (!active || handledRef.current || !detectorActiveRef.current) return;
        try {
          const barcodes = await detector.detect(video);
          const firstMatch = Array.isArray(barcodes) ? barcodes.find((item) => String(item?.rawValue || "").trim()) : null;
          if (firstMatch?.rawValue) {
            await handleDecodedValue(firstMatch.rawValue, stopNativeScanner);
            return;
          }
        } catch (error) {
          console.warn("[barcode-scanner:barcode-detector-detect-failed]", error);
        }
        nativeFrameRef.current = window.requestAnimationFrame(scanFrame);
      };

      nativeFrameRef.current = window.requestAnimationFrame(scanFrame);
      return true;
    };

    const startHtml5Scanner = async () => {
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
      const fps = 12;
      const qrbox = { width: 260, height: 260 };

      console.log("[SCANNER_START_CONFIG]", {
        cameraId,
        facingMode,
        fps,
        qrbox,
      });

      await scanner.start(
        cameraId || { facingMode },
        {
          fps,
          qrbox,
          aspectRatio: 1,
          disableFlip: false,
          formatsToSupport: supportedBarcodeFormats,
          videoConstraints: {
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        async (decodedText) => {
          await handleDecodedValue(decodedText, () => safeStopScanner(scanner));
        },
        () => {}
      );

      startedRef.current = true;
    };

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
        try {
          if (hasBarcodeDetectorSupport()) {
            console.log("[SCANNER_MODE]", { mode: "barcode-detector" });
            const startedWithDetector = await startBarcodeDetectorScanner();
            if (startedWithDetector) return;
          }
          console.log("[SCANNER_MODE]", { mode: "html5-qrcode-fallback" });
          await startHtml5Scanner();
        } catch (error) {
          console.error("[SCANNER_START_ERROR]", {
            error,
            name: error?.name,
            message: error?.message,
            stack: error?.stack,
          });
          throw error;
        }
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
      detectorActiveRef.current = false;
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      const nativeCleanup = stopNativeScanner();
      if (!scanner) {
        Promise.resolve(nativeCleanup).finally(() => {
          startedRef.current = false;
        });
        return;
      }

      const cleanup = startedRef.current ? safeStopScanner(scanner) : undefined;

      Promise.allSettled([Promise.resolve(cleanup), Promise.resolve(nativeCleanup)]).finally(() => {
        startedRef.current = false;
        safeClearScanner(scanner);
      });
    };
  }, [onError, onPermissionDenied, onScan, onUnsupported, scannerId]);

  return (
    <div className={className}>
      <video
        ref={nativeVideoRef}
        className={`${scannerClassName} hidden`}
        autoPlay
        muted
        playsInline
      />
      <div id={scannerId} className={scannerClassName} />
    </div>
  );
}
