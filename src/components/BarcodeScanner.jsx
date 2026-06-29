import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

const CAMERA_PERMISSION_DENIED_MESSAGE = "تم رفض إذن الكاميرا. فعّل الكاميرا من إعدادات المتصفح ثم حاول مرة أخرى.";
const CAMERA_UNSUPPORTED_MESSAGE = "المتصفح أو الجهاز الحالي لا يدعم مسح الباركود أو QR بالكاميرا.";
const CAMERA_START_FAILED_MESSAGE = "تعذر تشغيل الكاميرا الآن. حاول مرة أخرى.";
const DEFAULT_FRAME_HINT = "قرّب الباركود داخل المستطيل فقط";
const DEFAULT_STATUS_PRIMARY = "جاري القراءة...";
const DEFAULT_STATUS_SECONDARY = "استخدم إدخال يدوي لو القراءة تأخرت";
const NATIVE_SCAN_INTERVAL_MS = 80;
const NATIVE_FALLBACK_TIMEOUT_MS = 2500;
const CROP_TARGET_WIDTH = 640;
const CROP_TARGET_HEIGHT = 220;

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

const normalizeFormatName = (value = "") => String(value || "").trim().toUpperCase();
const formatHtml5ScanName = (result = {}) =>
  normalizeFormatName(result?.result?.format?.formatName || result?.result?.debugData?.decoderName || "");

const enhanceCropImage = (context, width, height) => {
  try {
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const contrast = 1.35;
    const intercept = 128 * (1 - contrast);
    for (let index = 0; index < pixels.length; index += 4) {
      const grayscale = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      const adjusted = Math.max(0, Math.min(255, grayscale * contrast + intercept));
      pixels[index] = adjusted;
      pixels[index + 1] = adjusted;
      pixels[index + 2] = adjusted;
    }
    context.putImageData(imageData, 0, 0);
  } catch (error) {
    console.warn("[barcode-scanner:enhance-crop-failed]", error);
  }
};

const buildFrameMetrics = (widthPercent = 85, heightPx = 140) => ({
  widthPercent,
  heightPx: Math.max(110, Math.min(150, Number(heightPx || 140))),
});

export default function BarcodeScanner({
  onScan,
  onPermissionDenied,
  onUnsupported,
  onError,
  onDebugChange,
  enable1dFallback = false,
  className = "",
  scannerClassName = "",
  detectorFormats = preferredBarcodeFormats,
  html5Formats = supportedBarcodeFormats,
  html5Fps = 12,
  html5Qrbox = { width: 260, height: 260 },
  html5AspectRatio = 1,
  videoConstraints = null,
  logPrefix = "",
  frameHint = DEFAULT_FRAME_HINT,
  statusPrimary = DEFAULT_STATUS_PRIMARY,
  statusSecondary = DEFAULT_STATUS_SECONDARY,
  overlayFrameWidthPercent = 85,
  overlayFrameHeight = 140,
}) {
  const scannerId = useId().replace(/:/g, "-");
  const html5QrCodeRef = useRef(null);
  const nativeVideoRef = useRef(null);
  const nativeStreamRef = useRef(null);
  const nativeDetectorRef = useRef(null);
  const nativeCanvasRef = useRef(null);
  const nativeLoopTimerRef = useRef(null);
  const nativeFallbackTimerRef = useRef(null);
  const handledRef = useRef(false);
  const activeModeRef = useRef("");
  const scanStartedAtRef = useRef(0);
  const fallbackStartedRef = useRef(false);
  const [statusMessage, setStatusMessage] = useState(statusPrimary);
  const frameMetrics = useMemo(
    () => buildFrameMetrics(overlayFrameWidthPercent, overlayFrameHeight),
    [overlayFrameHeight, overlayFrameWidthPercent]
  );

  const pushDebug = (payload = {}) => {
    onDebugChange?.({
      source: "scanner",
      scannerId,
      timestamp: new Date().toISOString(),
      ...payload,
    });
  };

  const emitScannerLog = (suffix, payload = {}, level = "info") => {
    if (!logPrefix) return;
    const logger = console[level] || console.info;
    logger(`${logPrefix}_${suffix}`, payload);
  };

  useEffect(() => {
    if (!isCameraSupported()) {
      onUnsupported?.(CAMERA_UNSUPPORTED_MESSAGE);
      return undefined;
    }

    let active = true;

    const desiredVideoConstraints = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }],
      ...(videoConstraints && typeof videoConstraints === "object" ? videoConstraints : {}),
    };

    const clearNativeTimers = () => {
      if (nativeLoopTimerRef.current) {
        window.clearTimeout(nativeLoopTimerRef.current);
        nativeLoopTimerRef.current = null;
      }
      if (nativeFallbackTimerRef.current) {
        window.clearTimeout(nativeFallbackTimerRef.current);
        nativeFallbackTimerRef.current = null;
      }
    };

    const stopNativeScanner = async () => {
      clearNativeTimers();
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
      nativeDetectorRef.current = null;
      activeModeRef.current = "";
    };

    const stopHtml5Scanner = async () => {
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      if (!scanner) return;
      await Promise.resolve(safeStopScanner(scanner));
      safeClearScanner(scanner);
      activeModeRef.current = "";
    };

    const stopAllScanners = async () => {
      await stopNativeScanner();
      await stopHtml5Scanner();
    };

    const finalizeSuccess = async (decodedText, metadata = {}) => {
      if (!active || handledRef.current) return;
      handledRef.current = true;
      const scannedValue = String(decodedText || "").trim();
      const durationMs = scanStartedAtRef.current ? Math.max(0, Math.round(performance.now() - scanStartedAtRef.current)) : 0;
      emitScannerLog("SCAN_DURATION_MS", {
        duration_ms: durationMs,
        mode: activeModeRef.current || metadata.source || "",
      });
      emitScannerLog("CROP_DETECT_SUCCESS", {
        value: scannedValue,
        format: normalizeFormatName(metadata.formatName || ""),
        source: metadata.source || "",
      });
      pushDebug({
        stage: "decoded",
        rawValue: scannedValue,
        detectedFormat: normalizeFormatName(metadata.formatName || ""),
        decoderSource: metadata.source || "",
        durationMs,
      });
      await stopAllScanners();
      onScan?.(scannedValue, metadata);
    };

    const applyTrackConstraints = async (stream) => {
      const track = stream?.getVideoTracks?.()?.[0];
      if (!track?.applyConstraints) return;
      try {
        await track.applyConstraints(desiredVideoConstraints);
      } catch (error) {
        pushDebug({
          stage: "track_constraints_failed",
          message: error?.message || String(error || ""),
        });
      }
    };

    const startHtml5Scanner = async () => {
      if (!active || handledRef.current) return;
      const scanner = new Html5Qrcode(scannerId);
      html5QrCodeRef.current = scanner;
      activeModeRef.current = "html5-qrcode";
      fallbackStartedRef.current = true;
      setStatusMessage(statusPrimary);
      emitScannerLog("HTML5_FALLBACK_START", {
        fps: html5Fps,
        qrbox: html5Qrbox,
      });

      const cameras = await Html5Qrcode.getCameras();
      if (!Array.isArray(cameras) || !cameras.length) {
        onError?.(CAMERA_START_FAILED_MESSAGE);
        return;
      }

      const preferredCamera =
        cameras.find((camera) => /back|rear|environment/i.test(String(camera?.label || ""))) ||
        cameras[0] ||
        null;

      await scanner.start(
        preferredCamera?.id || { facingMode: { ideal: "environment" } },
        {
          fps: html5Fps,
          qrbox: html5Qrbox,
          aspectRatio: html5AspectRatio,
          disableFlip: false,
          formatsToSupport: html5Formats,
          videoConstraints: desiredVideoConstraints,
        },
        async (decodedText, decodedResult) => {
          if (!active || handledRef.current) return;
          await finalizeSuccess(decodedText, {
            source: "html5-qrcode",
            formatName: formatHtml5ScanName(decodedResult),
          });
        },
        () => {}
      );

      pushDebug({ stage: "started", mode: "html5-qrcode" });
    };

    const scheduleNativeLoop = (callback) => {
      clearNativeTimers();
      nativeLoopTimerRef.current = window.setTimeout(callback, NATIVE_SCAN_INTERVAL_MS);
    };

    const runNativeDetectLoop = async () => {
      if (!active || handledRef.current || activeModeRef.current !== "barcode-detector") return;
      const detector = nativeDetectorRef.current;
      const video = nativeVideoRef.current;
      const canvas = nativeCanvasRef.current;
      if (!detector || !video || !canvas) return;
      if (video.readyState < 2 || video.paused || video.ended || !video.videoWidth || !video.videoHeight) {
        scheduleNativeLoop(runNativeDetectLoop);
        return;
      }

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        scheduleNativeLoop(runNativeDetectLoop);
        return;
      }

      const sourceWidth = Math.max(1, Math.floor(video.videoWidth * 0.85));
      const sourceHeight = Math.max(1, Math.floor(sourceWidth * (CROP_TARGET_HEIGHT / CROP_TARGET_WIDTH)));
      const sourceX = Math.max(0, Math.floor((video.videoWidth - sourceWidth) / 2));
      const sourceY = Math.max(0, Math.floor((video.videoHeight - sourceHeight) / 2));

      canvas.width = CROP_TARGET_WIDTH;
      canvas.height = CROP_TARGET_HEIGHT;
      context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, CROP_TARGET_WIDTH, CROP_TARGET_HEIGHT);
      enhanceCropImage(context, CROP_TARGET_WIDTH, CROP_TARGET_HEIGHT);

      try {
        const barcodes = await detector.detect(canvas);
        const firstMatch = Array.isArray(barcodes) ? barcodes.find((item) => String(item?.rawValue || "").trim()) : null;
        if (firstMatch?.rawValue) {
          await finalizeSuccess(firstMatch.rawValue, {
            source: "barcode-detector",
            formatName: firstMatch.format || "",
          });
          return;
        }
      } catch (error) {
        emitScannerLog("ERROR", {
          stage: "crop_detect",
          message: error?.message || String(error || ""),
        }, "error");
        pushDebug({
          stage: "error",
          mode: "barcode-detector",
          message: error?.message || String(error || ""),
        });
      }

      scheduleNativeLoop(runNativeDetectLoop);
    };

    const startNativeScanner = async () => {
      if (!hasBarcodeDetectorSupport()) return false;
      const video = nativeVideoRef.current;
      if (!video) return false;

      let detector;
      try {
        const supportedFormats =
          typeof window.BarcodeDetector.getSupportedFormats === "function"
            ? await window.BarcodeDetector.getSupportedFormats()
            : [];
        const requestedFormats = Array.isArray(detectorFormats) && detectorFormats.length ? detectorFormats : preferredBarcodeFormats;
        const formats = requestedFormats.filter((format) => supportedFormats.includes(format));
        detector = new window.BarcodeDetector({
          formats: formats.length ? formats : requestedFormats,
        });
      } catch (error) {
        emitScannerLog("ERROR", {
          stage: "barcode_detector_init",
          message: error?.message || String(error || ""),
        }, "error");
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: desiredVideoConstraints,
      });

      nativeStreamRef.current = stream;
      nativeDetectorRef.current = detector;
      await applyTrackConstraints(stream);
      video.srcObject = stream;
      video.style.display = "block";
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();

      activeModeRef.current = "barcode-detector";
      setStatusMessage(statusPrimary);
      emitScannerLog("CROP_DETECT_START", {
        width_percent: frameMetrics.widthPercent,
        frame_height_px: frameMetrics.heightPx,
      });
      pushDebug({ stage: "started", mode: "barcode-detector" });

      nativeFallbackTimerRef.current = window.setTimeout(async () => {
        if (!active || handledRef.current || activeModeRef.current !== "barcode-detector" || fallbackStartedRef.current) return;
        emitScannerLog("CROP_DETECT_TIMEOUT_FALLBACK", {
          timeout_ms: NATIVE_FALLBACK_TIMEOUT_MS,
        });
        setStatusMessage(statusSecondary);
        await stopNativeScanner();
        await startHtml5Scanner();
      }, NATIVE_FALLBACK_TIMEOUT_MS);

      scheduleNativeLoop(runNativeDetectLoop);
      return true;
    };

    const startScanner = async () => {
      scanStartedAtRef.current = performance.now();
      try {
        if (!enable1dFallback && hasBarcodeDetectorSupport()) {
          const startedWithNative = await startNativeScanner();
          if (startedWithNative) return;
        }
        await startHtml5Scanner();
      } catch (error) {
        const classified = classifyCameraError(error);
        if (!active) return;
        emitScannerLog("ERROR", {
          stage: "start_scanner",
          name: error?.name || "",
          message: error?.message || String(error || ""),
        }, "error");
        if (classified.type === "permission") onPermissionDenied?.(classified.message);
        else if (classified.type === "unsupported") onUnsupported?.(classified.message);
        else onError?.(classified.message);
      }
    };

    startScanner();

    return () => {
      active = false;
      handledRef.current = false;
      void stopAllScanners().finally(() => {
        emitScannerLog("STOPPED", {
          mode: activeModeRef.current || "unknown",
        });
        activeModeRef.current = "";
      });
    };
  }, [
    detectorFormats,
    enable1dFallback,
    frameMetrics.heightPx,
    frameMetrics.widthPercent,
    html5AspectRatio,
    html5Formats,
    html5Fps,
    html5Qrbox,
    logPrefix,
    onDebugChange,
    onError,
    onPermissionDenied,
    onScan,
    onUnsupported,
    scannerId,
    statusPrimary,
    statusSecondary,
    videoConstraints,
  ]);

  return (
    <div className={`relative ${className}`.trim()}>
      <video ref={nativeVideoRef} className={`${scannerClassName} hidden`} autoPlay muted playsInline />
      <canvas ref={nativeCanvasRef} className="hidden" />
      <div id={scannerId} className={scannerClassName} />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 text-white">
        <div className="mx-auto mt-2 rounded-full bg-black/45 px-3 py-1 text-[11px] font-black tracking-[0.12em] text-white/90">
          {statusMessage}
        </div>
        <div className="mb-6 flex flex-col items-center gap-3">
          <div
            className="rounded-2xl border-2 border-emerald-300/90 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
            style={{
              width: `${frameMetrics.widthPercent}%`,
              height: `${frameMetrics.heightPx}px`,
            }}
          />
          <div className="rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white/90">
            {frameHint || DEFAULT_FRAME_HINT}
          </div>
          <div className="text-center text-[11px] font-semibold text-zinc-200/90">
            {statusSecondary}
          </div>
        </div>
      </div>
    </div>
  );
}
