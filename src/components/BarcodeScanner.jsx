import { useEffect, useId, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from "@zxing/library";

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

const zxing1dFormats = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
];

const normalizeFormatName = (value = "") => String(value || "").trim().toUpperCase();
const formatHtml5ScanName = (result = {}) => normalizeFormatName(result?.result?.format?.formatName || result?.result?.debugData?.decoderName || "");
const formatZxingScanName = (result = null) => {
  if (!result?.getBarcodeFormat) return "";
  const format = result.getBarcodeFormat();
  return normalizeFormatName(BarcodeFormat?.[format] || format);
};

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
}) {
  const scannerId = useId().replace(/:/g, "-");
  const html5QrCodeRef = useRef(null);
  const nativeVideoRef = useRef(null);
  const zxingVideoRef = useRef(null);
  const nativeStreamRef = useRef(null);
  const nativeFrameRef = useRef(null);
  const zxingReaderRef = useRef(null);
  const zxingRunningRef = useRef(false);
  const detectorActiveRef = useRef(false);
  const handledRef = useRef(false);
  const startedRef = useRef(false);
  const activeModeRef = useRef("");
  const fallbackLoggedRef = useRef(false);

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

    const desiredVideoConstraints = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      advanced: [
        { focusMode: "continuous" },
        { exposureMode: "continuous" },
      ],
      ...(videoConstraints && typeof videoConstraints === "object" ? videoConstraints : {}),
    };

    const stopZxingScanner = async () => {
      zxingRunningRef.current = false;
      const reader = zxingReaderRef.current;
      zxingReaderRef.current = null;
      try {
        reader?.reset?.();
      } catch (error) {
        console.warn("[barcode-scanner:zxing-reset-failed]", error);
      }
      const video = zxingVideoRef.current;
      if (video) {
        try {
          video.pause?.();
        } catch {
          // noop
        }
        video.srcObject = null;
      }
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

    const handleDecodedValue = async (decodedText, stopCurrentScanner, metadata = {}) => {
      if (!active || handledRef.current) return;
      handledRef.current = true;
      const scannedValue = String(decodedText || "").trim();
      console.info("[employee-scanner]", scannedValue);
      emitScannerLog("DETECTED", {
        value: scannedValue,
        format: normalizeFormatName(metadata.formatName || ""),
        source: metadata.source || "",
      });
      pushDebug({
        stage: "decoded",
        rawValue: scannedValue,
        detectedFormat: normalizeFormatName(metadata.formatName || ""),
        decoderSource: metadata.source || "",
      });
      try {
        await stopCurrentScanner?.();
        if (metadata.source === "zxing") {
          await stopZxingScanner();
        }
      } catch {
        // Ignore teardown errors during handoff.
      }
      startedRef.current = false;
      onScan?.(scannedValue, metadata);
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
      await stopZxingScanner();
      activeModeRef.current = "";
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
        const requestedFormats = Array.isArray(detectorFormats) && detectorFormats.length ? detectorFormats : preferredBarcodeFormats;
        const formats = requestedFormats.filter((format) => supportedFormats.includes(format));
        detector = new window.BarcodeDetector({
          formats: formats.length ? formats : requestedFormats,
        });
      } catch (error) {
        console.warn("[barcode-scanner:barcode-detector-init-failed]", error);
        emitScannerLog("ERROR", {
          stage: "barcode_detector_init",
          message: error?.message || String(error || ""),
        }, "error");
        return false;
      }

      const constraints = {
        audio: false,
        video: desiredVideoConstraints,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      nativeStreamRef.current = stream;
      await applyTrackConstraints(stream);
      video.srcObject = stream;
      video.style.display = "block";
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();

      detectorActiveRef.current = true;
      startedRef.current = true;
      activeModeRef.current = "barcode-detector";
      emitScannerLog("STARTED", {
        mode: "barcode-detector",
        constraints: desiredVideoConstraints,
      });
      pushDebug({ stage: "started", mode: "barcode-detector" });

      const scanFrame = async () => {
        if (!active || handledRef.current || !detectorActiveRef.current) return;
        try {
          const barcodes = await detector.detect(video);
          const firstMatch = Array.isArray(barcodes) ? barcodes.find((item) => String(item?.rawValue || "").trim()) : null;
          if (firstMatch?.rawValue) {
            await handleDecodedValue(firstMatch.rawValue, stopNativeScanner, {
              source: "barcode-detector",
              formatName: firstMatch.format || "",
            });
            return;
          }
        } catch (error) {
          console.warn("[barcode-scanner:barcode-detector-detect-failed]", error);
          emitScannerLog("ERROR", {
            stage: "barcode_detector_detect",
            message: error?.message || String(error || ""),
          }, "error");
          pushDebug({
            stage: "error",
            mode: "barcode-detector",
            message: error?.message || String(error || ""),
          });
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
      const fps = html5Fps;
      const qrbox = html5Qrbox;

      console.log("[SCANNER_START_CONFIG]", {
        cameraId,
        facingMode,
        fps,
        qrbox,
      });

      if (!fallbackLoggedRef.current) {
        fallbackLoggedRef.current = true;
        emitScannerLog("FALLBACK_USED", {
          mode: "html5-qrcode",
        });
      }

      await scanner.start(
        cameraId || { facingMode },
        {
          fps,
          qrbox,
          aspectRatio: html5AspectRatio,
          disableFlip: false,
          formatsToSupport: html5Formats,
          videoConstraints: {
            facingMode,
            ...desiredVideoConstraints,
          },
        },
        async (decodedText, decodedResult) => {
          await handleDecodedValue(decodedText, () => safeStopScanner(scanner), {
            source: "html5-qrcode",
            formatName: formatHtml5ScanName(decodedResult),
          });
        },
        () => {}
      );

      startedRef.current = true;
      activeModeRef.current = "html5-qrcode";
      emitScannerLog("STARTED", {
        mode: "html5-qrcode",
        fps,
        qrbox,
      });
      pushDebug({ stage: "started", mode: "html5-qrcode" });

      if (enable1dFallback) {
        const container = typeof document !== "undefined" ? document.getElementById(scannerId) : null;
        const renderedVideo = container?.querySelector?.("video");
        const stream = renderedVideo?.srcObject instanceof MediaStream ? renderedVideo.srcObject : null;
        const zxingVideo = zxingVideoRef.current;
        if (stream && zxingVideo) {
          try {
            const hints = new Map();
            hints.set(DecodeHintType.POSSIBLE_FORMATS, zxing1dFormats);
            const reader = new BrowserMultiFormatReader(hints, 120);
            zxingReaderRef.current = reader;
            zxingRunningRef.current = true;
            zxingVideo.muted = true;
            zxingVideo.playsInline = true;
            zxingVideo.setAttribute("playsinline", "true");
            zxingVideo.style.display = "none";
            if (!fallbackLoggedRef.current) {
              fallbackLoggedRef.current = true;
              emitScannerLog("FALLBACK_USED", {
                mode: "zxing-1d",
              });
            }
            pushDebug({ stage: "fallback_started", mode: "zxing-1d", enabled: true });
            reader.decodeFromStream(stream, zxingVideo, async (result, error) => {
              if (!active || handledRef.current || !zxingRunningRef.current) return;
              if (result) {
                const rawValue = String(result.getText?.() || "").trim();
                const formatName = formatZxingScanName(result);
                if (!rawValue) return;
                if (formatName === "QR_CODE") {
                  pushDebug({
                    stage: "fallback_ignored",
                    mode: "zxing-1d",
                    rawValue,
                    detectedFormat: formatName,
                  });
                  return;
                }
                await handleDecodedValue(rawValue, stopZxingScanner, {
                  source: "zxing",
                  formatName,
                });
                return;
              }
              if (error) {
                pushDebug({
                  stage: "fallback_error",
                  mode: "zxing-1d",
                  message: error?.message || String(error || ""),
                });
              }
            }).catch((error) => {
              console.warn("[barcode-scanner:zxing-fallback-start-failed]", error);
              emitScannerLog("ERROR", {
                stage: "zxing_fallback_start",
                message: error?.message || String(error || ""),
              }, "error");
              pushDebug({
                stage: "fallback_error",
                mode: "zxing-1d",
                message: error?.message || String(error || ""),
              });
            });
          } catch (error) {
            console.warn("[barcode-scanner:zxing-fallback-failed]", error);
            emitScannerLog("ERROR", {
              stage: "zxing_fallback",
              message: error?.message || String(error || ""),
            }, "error");
            pushDebug({
              stage: "fallback_error",
              mode: "zxing-1d",
              message: error?.message || String(error || ""),
            });
          }
        } else {
          pushDebug({ stage: "fallback_unavailable", mode: "zxing-1d" });
        }
      }
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
          if (!enable1dFallback && hasBarcodeDetectorSupport()) {
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
        emitScannerLog("ERROR", {
          stage: "scanner_start",
          name: error?.name || "",
          message: error?.message || String(error || ""),
        }, "error");
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
          emitScannerLog("ERROR", {
            stage: "classified_error",
            name: error?.name || "",
            message: error?.message || String(error || ""),
          }, "error");
          onError?.(classified.message);
        }
      }
    };

    startScanner();

    return () => {
      active = false;
      handledRef.current = false;
      detectorActiveRef.current = false;
      const stoppedMode = activeModeRef.current || "unknown";
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      const nativeCleanup = stopNativeScanner();
      if (!scanner) {
        Promise.resolve(nativeCleanup).finally(() => {
          startedRef.current = false;
          emitScannerLog("STOPPED", {
            mode: stoppedMode,
          });
          activeModeRef.current = "";
        });
        return;
      }

      const cleanup = startedRef.current ? safeStopScanner(scanner) : undefined;

      Promise.allSettled([Promise.resolve(cleanup), Promise.resolve(nativeCleanup)]).finally(() => {
        startedRef.current = false;
        safeClearScanner(scanner);
        emitScannerLog("STOPPED", {
          mode: stoppedMode,
        });
        activeModeRef.current = "";
      });
    };
  }, [
    detectorFormats,
    enable1dFallback,
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
    videoConstraints,
  ]);

  return (
    <div className={className}>
      <video
        ref={nativeVideoRef}
        className={`${scannerClassName} hidden`}
        autoPlay
        muted
        playsInline
      />
      <video
        ref={zxingVideoRef}
        className="hidden"
        autoPlay
        muted
        playsInline
      />
      <div id={scannerId} className={scannerClassName} />
    </div>
  );
}
