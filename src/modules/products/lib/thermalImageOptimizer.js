const THERMAL_IMAGE_OPTIMIZER_VERSION = "v4-conservative";

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image blob"));
    reader.readAsDataURL(blob);
  });

export const loadImageDataUrl = async (url) => {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return "";
  if (safeUrl.startsWith("data:")) return safeUrl;
  try {
    const response = await fetch(safeUrl, { credentials: "omit" });
    if (!response.ok) return "";
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return "";
  }
};

const loadCanvasImage = async (src) =>
  new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Image is not available"));
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

export const prepareThermalImage = async (imageData) => {
  if (!imageData || typeof document === "undefined") {
    return "";
  }

  try {
    const normalizedSource = await loadImageDataUrl(imageData);
    if (!normalizedSource) return "";

    const image = await loadCanvasImage(normalizedSource);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width || 0;
    canvas.height = image.naturalHeight || image.height || 0;
    if (!canvas.width || !canvas.height) return "";

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "";

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const sourceBuffer = context.getImageData(0, 0, canvas.width, canvas.height);
    const sourceData = sourceBuffer.data;
    const pixelCount = sourceData.length / 4;
    const luminances = new Float32Array(pixelCount);
    const histogram = new Uint32Array(256);

    let luminanceSum = 0;

    for (let offset = 0, pixelIndex = 0; offset < sourceData.length; offset += 4, pixelIndex += 1) {
      const luminance = (sourceData[offset] * 0.299) + (sourceData[offset + 1] * 0.587) + (sourceData[offset + 2] * 0.114);
      luminances[pixelIndex] = luminance;
      histogram[clampByte(luminance)] += 1;
      luminanceSum += luminance;
    }

    const lowPercentile = 0.04;
    const highPercentile = 0.96;
    const findPercentile = (percent) => {
      const target = pixelCount * percent;
      let running = 0;
      for (let index = 0; index < histogram.length; index += 1) {
        running += histogram[index];
        if (running >= target) return index;
      }
      return 255;
    };
    const lowCut = findPercentile(lowPercentile);
    const highCut = Math.max(lowCut + 1, findPercentile(highPercentile));
    const range = Math.max(1, highCut - lowCut);

    const output = new Uint8ClampedArray(sourceData);
    const width = canvas.width;
    const height = canvas.height;
    const gamma = 0.96;
    const brightnessScale = 0.98;
    const contrastScale = 1.15;
    const sharpnessAmount = 0.1;

    const getLuminanceAt = (x, y) => {
      const clampedX = Math.max(0, Math.min(width - 1, x));
      const clampedY = Math.max(0, Math.min(height - 1, y));
      return luminances[(clampedY * width) + clampedX] || 0;
    };

    const getAutoLevel = (luminance) => clampByte(((luminance - lowCut) / range) * 255);

    for (let offset = 0, pixelIndex = 0; offset < output.length; offset += 4, pixelIndex += 1) {
      const luminance = luminances[pixelIndex];
      const leveled = getAutoLevel(luminance);
      const brightnessAdjusted = clampByte(leveled * brightnessScale);
      const contrastAdjusted = clampByte((((brightnessAdjusted - 128) * contrastScale) + 128));
      const gammaAdjusted = clampByte(Math.pow(Math.max(0, Math.min(1, contrastAdjusted / 255)), gamma) * 255);

      const currentX = pixelIndex % width;
      const currentY = Math.floor(pixelIndex / width);
      const blurred =
        getLuminanceAt(currentX - 1, currentY - 1) +
        getLuminanceAt(currentX, currentY - 1) +
        getLuminanceAt(currentX + 1, currentY - 1) +
        getLuminanceAt(currentX - 1, currentY) +
        luminance +
        getLuminanceAt(currentX + 1, currentY) +
        getLuminanceAt(currentX - 1, currentY + 1) +
        getLuminanceAt(currentX, currentY + 1) +
        getLuminanceAt(currentX + 1, currentY + 1);
      const localAverage = blurred / 9;
      const sharpened = clampByte(gammaAdjusted + ((gammaAdjusted - localAverage) * sharpnessAmount));
      const finalGray = clampByte(sharpened);

      output[offset] = finalGray;
      output[offset + 1] = finalGray;
      output[offset + 2] = finalGray;
      output[offset + 3] = sourceData[offset + 3];
    }

    context.putImageData(new ImageData(output, width, height), 0, 0);
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("[barcode-pdf] thermal image optimizer failed", error);
    return "";
  }
};

export { THERMAL_IMAGE_OPTIMIZER_VERSION };
