const COLOR_DICTIONARY = [
  { name: "White", hex: "#f5f5f2" },
  { name: "Off White", hex: "#eee8dc" },
  { name: "Cream", hex: "#f3e2bf" },
  { name: "Beige", hex: "#d8c8b4" },
  { name: "Black", hex: "#111111" },
  { name: "Grey", hex: "#7d8187" },
  { name: "Silver", hex: "#c7c9cc" },
  { name: "Red", hex: "#c62828" },
  { name: "Burgundy", hex: "#6d1f2f" },
  { name: "Pink", hex: "#e779a4" },
  { name: "Rose", hex: "#c95f73" },
  { name: "Orange", hex: "#e36b24" },
  { name: "Yellow", hex: "#e6c62f" },
  { name: "Gold", hex: "#c79a2d" },
  { name: "Green", hex: "#2f8d46" },
  { name: "Olive", hex: "#6f7431" },
  { name: "Mint", hex: "#9bd9bf" },
  { name: "Blue", hex: "#2766b3" },
  { name: "Navy", hex: "#182e55" },
  { name: "Sky Blue", hex: "#7dbde8" },
  { name: "Purple", hex: "#7651a8" },
  { name: "Brown", hex: "#6f4428" },
  { name: "Camel", hex: "#b8864f" },
  { name: "Tan", hex: "#c79b72" },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const hexToRgb = (hex) => {
  const value = String(hex || "").replace("#", "");
  const int = Number.parseInt(value.length === 3 ? value.split("").map((item) => item + item).join("") : value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
};

const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;

const rgbToHsl = ({ r, g, b }) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (!delta) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: saturation, l: lightness };
};

const brightnessOf = ({ r, g, b }) => (r + g + b) / 3;
const isWarmNeutral = ({ r, g, b }) => r >= b + 3 && g >= b - 5;
const isNeutralPixel = (rgb) => rgbToHsl(rgb).s <= 0.2;

const colorDistance = (a, b) => {
  const ah = rgbToHsl(a);
  const bh = rgbToHsl(b);
  const hueDelta = Math.min(Math.abs(ah.h - bh.h), 360 - Math.abs(ah.h - bh.h)) / 180;
  const satDelta = Math.abs(ah.s - bh.s);
  const lightDelta = Math.abs(ah.l - bh.l);
  const rgbDelta = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) / 441.7;
  return rgbDelta * 0.45 + hueDelta * 0.28 + satDelta * 0.14 + lightDelta * 0.13;
};

const nearestFashionColor = (rgb) => {
  let best = COLOR_DICTIONARY[0];
  let bestDistance = Infinity;
  for (const entry of COLOR_DICTIONARY) {
    const distance = colorDistance(rgb, hexToRgb(entry.hex));
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return {
    name: best.name,
    distance: bestDistance,
  };
};

const hasStrongBlueDominance = ({ r, g, b }) => b > r * 1.25 && b > g * 1.12;

const isClearlyNavy = (rgb) => {
  const hsl = rgbToHsl(rgb);
  return brightnessOf(rgb) < 120 && hsl.s >= 0.28 && hsl.h >= 200 && hsl.h <= 245 && hasStrongBlueDominance(rgb);
};

const fashionColorNameFor = (rgb) => {
  const nearest = nearestFashionColor(rgb);
  if (nearest.name !== "Navy") return nearest;

  const hsl = rgbToHsl(rgb);
  const brightness = brightnessOf(rgb);
  const weakBlueDominance = !hasStrongBlueDominance(rgb);
  if (!isClearlyNavy(rgb) || (brightness < 75 && (hsl.s < 0.35 || weakBlueDominance))) {
    return { name: "Black", distance: colorDistance(rgb, hexToRgb("#111111")) };
  }
  return nearest;
};

const isNearWhite = ({ r, g, b }) => r > 226 && g > 222 && b > 214 && Math.max(r, g, b) - Math.min(r, g, b) < 34;
const isNearBlack = ({ r, g, b }) => r < 34 && g < 34 && b < 34;
const isTransparent = (alpha) => alpha < 24;

const pixelFromData = (data, index) => ({
  r: data[index],
  g: data[index + 1],
  b: data[index + 2],
  a: data[index + 3],
});

const colorResult = ({ name, rgb, confidence = 0.8 }) => ({
  name,
  secondaryName: null,
  label: name,
  hex: rgbToHex(rgb),
  secondaryHex: null,
  confidence: Number(clamp(confidence, 0.05, 0.99).toFixed(2)),
});

const loadImage = (source) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    let objectUrl = "";
    image.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to load image"));
    };
    const isFileLike = (typeof File !== "undefined" && source instanceof File) || (typeof Blob !== "undefined" && source instanceof Blob);
    if (isFileLike) {
      objectUrl = URL.createObjectURL(source);
      image.src = objectUrl;
      return;
    }
    image.crossOrigin = "anonymous";
    image.src = String(source || "");
  });

const getCanvasPixels = async (source) => {
  const image = await loadImage(source);
  const maxSide = 160;
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(image, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
};

const sampleCircleFromCanvas = (canvasPixels, point, options = {}) => {
  const { data, width, height } = canvasPixels;
  const x = clamp(Math.round((point?.xRatio ?? 0.5) * (width - 1)), 0, width - 1);
  const y = clamp(Math.round((point?.yRatio ?? 0.5) * (height - 1)), 0, height - 1);
  const radius = clamp(Math.round(width * 0.08), 12, 36);
  const centerPixel = pixelFromData(data, (y * width + x) * 4);
  const background = options.background || estimateBackgroundColor(canvasPixels);
  const floodBackground = options.floodBackground || floodFillBackground(canvasPixels, background);
  const clickedBackground =
    isTransparent(centerPixel.a) ||
    Boolean(floodBackground[y * width + x]) ||
    (isNearWhite(centerPixel) && (isBorderPixel(x, y, width, height) || isCloseToBackground(centerPixel, background)));
  const samples = [];

  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
      const distance = Math.hypot(xx - x, yy - y);
      if (distance > radius) continue;
      const pixel = pixelFromData(data, (yy * width + xx) * 4);
      if (isTransparent(pixel.a)) continue;
      if (clickedBackground && isNearWhite(pixel) && colorDistance(pixel, { r: 255, g: 255, b: 255 }) < 0.08) continue;
      if (options.ignoreNearWhiteBackground && isNearWhite(pixel) && (floodBackground[yy * width + xx] || isCloseToBackground(pixel, background))) continue;
      const radialWeight = 1 - (distance / radius) * 0.58;
      samples.push({ r: pixel.r, g: pixel.g, b: pixel.b, weight: radialWeight });
    }
  }

  return samples;
};

const medianAverageColor = (samples) => {
  if (!samples.length) return null;
  const weightedAverage = averageColor(samples);
  const medianOf = (channel) => {
    const values = [...samples].sort((a, b) => a[channel] - b[channel]);
    return values[Math.floor(values.length / 2)]?.[channel] ?? weightedAverage[channel];
  };
  return {
    r: weightedAverage.r * 0.55 + medianOf("r") * 0.45,
    g: weightedAverage.g * 0.55 + medianOf("g") * 0.45,
    b: weightedAverage.b * 0.55 + medianOf("b") * 0.45,
  };
};

const nameForSampledRgb = (rgb, sampleStats = {}) => {
  const hsl = rgbToHsl(rgb);
  const brightness = brightnessOf(rgb);
  const neutral = neutralNameFor(rgb, {
    nearWhiteRatio: sampleStats.nearWhiteRatio || 0,
    metallicContrast: false,
  });
  if (neutral) return neutral;
  if (brightness < 55 && hsl.s <= 0.45) return "Black";
  return fashionColorNameFor(rgb).name;
};

const quantizePixel = ({ r, g, b }, size = 18) =>
  `${Math.round(r / size) * size},${Math.round(g / size) * size},${Math.round(b / size) * size}`;

const estimateBackgroundColor = ({ data, width, height }) => {
  const buckets = new Map();
  let edgeTotal = 0;
  const edgeDepth = Math.max(2, Math.round(Math.min(width, height) * 0.08));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= edgeDepth && x < width - edgeDepth && y >= edgeDepth && y < height - edgeDepth) continue;
      const pixel = pixelFromData(data, (y * width + x) * 4);
      if (isTransparent(pixel.a)) continue;
      const key = quantizePixel(pixel);
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += pixel.r;
      bucket.g += pixel.g;
      bucket.b += pixel.b;
      buckets.set(key, bucket);
      edgeTotal += 1;
    }
  }
  if (!edgeTotal) return { rgb: null, share: 0 };
  const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  return {
    rgb: {
      r: dominant.r / dominant.count,
      g: dominant.g / dominant.count,
      b: dominant.b / dominant.count,
    },
    share: dominant.count / edgeTotal,
  };
};

const isCloseToBackground = (pixel, background) => {
  if (!background?.rgb || background.share < 0.22) return false;
  const threshold = isNearWhite(background.rgb) || isNearBlack(background.rgb) ? 0.09 : 0.075;
  return colorDistance(pixel, background.rgb) <= threshold;
};

const isBorderPixel = (x, y, width, height) => {
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.08));
  return x < margin || y < margin || x >= width - margin || y >= height - margin;
};

const centerWeightFor = (x, y, width, height) => {
  const nx = (x + 0.5) / width - 0.5;
  const ny = (y + 0.5) / height - 0.5;
  const distance = Math.hypot(nx, ny) / Math.SQRT1_2;
  return clamp(1.25 - distance * 0.72, 0.45, 1.25);
};

const objectPixelWeight = (pixel, x, y, width, height, darkPixelRatio, objectMask = null) => {
  const brightness = brightnessOf(pixel);
  const hsl = rgbToHsl(pixel);
  let weight = centerWeightFor(x, y, width, height);
  if (objectMask?.bounds) weight *= sneakerVerticalWeight(pixel, y, objectMask.bounds);
  if (objectMask?.soleMask?.[y * width + x]) weight *= brightness >= 190 ? 0.25 : 0.4;
  if (brightness >= 215 && hsl.s <= 0.24) weight *= 1.38;
  else if (brightness >= 185) weight *= 1.16;
  else if (brightness < 85) weight *= darkPixelRatio > 0.22 ? 0.95 : 0.48;
  else if (brightness <= 105) weight *= 0.62;
  return weight;
};

const createEmptyBounds = () => ({ minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 });

const addToBounds = (bounds, x, y) => {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
};

const normalizeBounds = (bounds, width, height) =>
  bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY
    ? bounds
    : { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };

const verticalObjectPosition = (y, bounds) => {
  const objectHeight = Math.max(1, bounds.maxY - bounds.minY + 1);
  return clamp((y - bounds.minY) / objectHeight, 0, 1);
};

const sneakerVerticalWeight = (pixel, y, bounds) => {
  const position = verticalObjectPosition(y, bounds);
  const brightness = brightnessOf(pixel);
  let weight = 1;
  if (position >= 0.78) {
    const bottomProgress = clamp((position - 0.78) / 0.22, 0, 1);
    weight *= 1 - bottomProgress * 0.42;
    if (brightness >= 190) weight *= 1 - bottomProgress * 0.56;
  } else if (position >= 0.66 && brightness >= 215) {
    weight *= 0.78;
  } else if (position >= 0.18 && position <= 0.64) {
    weight *= 1.12;
  }
  return clamp(weight, 0.18, 1.18);
};

const floodFillBackground = (canvasPixels, background) => {
  const { data, width, height } = canvasPixels;
  const total = width * height;
  const mask = new Uint8Array(total);
  const queue = [];
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (mask[index]) return;
    const pixel = pixelFromData(data, index * 4);
    if (isTransparent(pixel.a)) {
      mask[index] = 1;
      queue.push(index);
      return;
    }
    const backgroundLike = isCloseToBackground(pixel, background);
    const whiteBorderBackground = isNearWhite(pixel) && isBorderPixel(x, y, width, height);
    if (!backgroundLike && !whiteBorderBackground) return;
    mask[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const x = current % width;
    const y = Math.floor(current / width);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) enqueue(nx, ny);
  }

  return mask;
};

const detectSoleMask = (canvasPixels, objectMask, bounds) => {
  const { data, width, height } = canvasPixels;
  const soleMask = new Uint8Array(width * height);
  const objectWidth = Math.max(1, bounds.maxX - bounds.minX + 1);
  let ignored = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    const position = verticalObjectPosition(y, bounds);
    if (position < 0.64) continue;
    let brightRun = 0;
    let bestRun = 0;
    const brightIndexes = [];
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const index = y * width + x;
      if (!objectMask[index]) {
        brightRun = 0;
        continue;
      }
      const pixel = pixelFromData(data, index * 4);
      const brightNeutral = brightnessOf(pixel) >= 188 && rgbToHsl(pixel).s <= 0.24;
      if (brightNeutral) {
        brightRun += 1;
        bestRun = Math.max(bestRun, brightRun);
        brightIndexes.push(index);
      } else {
        brightRun = 0;
      }
    }
    if (bestRun / objectWidth >= 0.22 || (position >= 0.78 && brightIndexes.length / objectWidth >= 0.18)) {
      for (const index of brightIndexes) {
        soleMask[index] = 1;
        ignored += 1;
      }
    }
  }
  return { soleMask, solePixelCount: ignored };
};

const buildObjectMask = (canvasPixels, background) => {
  const { data, width, height } = canvasPixels;
  const total = width * height;
  const candidates = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const floodBackground = floodFillBackground(canvasPixels, background);
  let visibleCount = 0;
  let backgroundLikeCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const pixel = pixelFromData(data, index * 4);
      if (isTransparent(pixel.a)) continue;
      visibleCount += 1;
      const backgroundLike = isCloseToBackground(pixel, background);
      const floodLike = Boolean(floodBackground[index]);
      if (backgroundLike || floodLike) backgroundLikeCount += 1;
      if (backgroundLike || floodLike) continue;
      if (isNearWhite(pixel) && isBorderPixel(x, y, width, height)) continue;
      candidates[index] = 1;
    }
  }

  const components = [];
  const queue = [];
  for (let index = 0; index < total; index += 1) {
    if (!candidates[index] || visited[index]) continue;
    visited[index] = 1;
    queue.length = 0;
    queue.push(index);
    const pixels = [];
    let centerScore = 0;
    let borderCount = 0;

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      centerScore += centerWeightFor(x, y, width, height);
      if (isBorderPixel(x, y, width, height)) borderCount += 1;

      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || !candidates[next]) continue;
        const nx = next % width;
        if ((current % width === 0 && nx === width - 1) || (current % width === width - 1 && nx === 0)) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    const centerAverage = centerScore / pixels.length;
    components.push({
      pixels,
      size: pixels.length,
      centerAverage,
      borderRatio: borderCount / pixels.length,
      score: pixels.length * centerAverage * (1 - Math.min(0.55, borderCount / pixels.length)),
    });
  }

  components.sort((a, b) => b.score - a.score);
  const best = components[0];
  const mask = new Uint8Array(total);
  const bounds = createEmptyBounds();
  if (best && best.size >= Math.max(16, visibleCount * 0.015)) {
    const keepThreshold = Math.max(10, best.size * 0.18);
    for (const component of components) {
      if (component === best || (component.size >= keepThreshold && component.centerAverage >= 0.62 && component.borderRatio < 0.55)) {
        for (const pixelIndex of component.pixels) {
          mask[pixelIndex] = 1;
          addToBounds(bounds, pixelIndex % width, Math.floor(pixelIndex / width));
        }
      }
    }
  }

  const objectPixelCount = mask.reduce((sum, value) => sum + value, 0);
  const finalBounds = normalizeBounds(bounds, width, height);
  const sole = objectPixelCount ? detectSoleMask(canvasPixels, mask, finalBounds) : { soleMask: new Uint8Array(total), solePixelCount: 0 };
  return {
    mask,
    floodBackground,
    soleMask: sole.soleMask,
    bounds: finalBounds,
    objectPixelCount,
    backgroundRatio: visibleCount ? backgroundLikeCount / visibleCount : 0,
    ignoredSoleRatio: objectPixelCount ? sole.solePixelCount / objectPixelCount : 0,
    hasMask: objectPixelCount >= 20,
  };
};

const collectSamples = (canvasPixels) => {
  const { data, width, height } = canvasPixels;
  const background = estimateBackgroundColor(canvasPixels);
  const objectMask = buildObjectMask(canvasPixels, background);
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 9000)));
  const samples = [];
  let visiblePixels = 0;
  let darkPixels = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    const pixel = pixelFromData(data, i);
    if (isTransparent(pixel.a)) continue;
    visiblePixels += 1;
    if (brightnessOf(pixel) < 85) darkPixels += 1;
  }
  const darkPixelRatio = visiblePixels ? darkPixels / visiblePixels : 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const maskIndex = y * width + x;
      const pixel = pixelFromData(data, (y * width + x) * 4);
      if (isTransparent(pixel.a)) continue;
      const backgroundLike = isCloseToBackground(pixel, background);
      const borderLike = isBorderPixel(x, y, width, height);
      if (objectMask.hasMask) {
        if (!objectMask.mask[maskIndex]) continue;
      } else if (backgroundLike && (borderLike || colorDistance(pixel, background.rgb) <= 0.055)) {
        continue;
      }
      const weight = objectPixelWeight(pixel, x, y, width, height, darkPixelRatio, objectMask);
      if (weight <= 0.05) continue;
      const verticalPosition = verticalObjectPosition(y, objectMask.bounds);
      samples.push({
        r: pixel.r,
        g: pixel.g,
        b: pixel.b,
        weight: objectMask.hasMask ? weight : weight * (borderLike ? 0.62 : 1),
        borderLike,
        backgroundLike,
        soleLike: Boolean(objectMask.soleMask?.[maskIndex]),
        verticalPosition,
        centerScore: centerWeightFor(x, y, width, height),
        objectConfidence: objectMask.hasMask ? 1 : backgroundLike ? 0.35 : 0.72,
        inObject: objectMask.hasMask ? Boolean(objectMask.mask[maskIndex]) : !backgroundLike,
      });
    }
  }
  if (samples.length > 20) {
    samples.meta = {
      backgroundRatio: objectMask.backgroundRatio,
      ignoredSoleRatio: objectMask.ignoredSoleRatio,
      objectPixelCount: objectMask.objectPixelCount || samples.length,
    };
    return samples;
  }

  // Fallback for low-contrast catalog photos, especially all-white or off-white shoes on light backgrounds.
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const pixel = pixelFromData(data, (y * width + x) * 4);
      if (!isTransparent(pixel.a)) {
        const borderLike = isBorderPixel(x, y, width, height);
        samples.push({
          r: pixel.r,
          g: pixel.g,
          b: pixel.b,
          weight: centerWeightFor(x, y, width, height) * (borderLike ? 0.45 : 1),
          borderLike,
          backgroundLike: isCloseToBackground(pixel, background),
          soleLike: false,
          verticalPosition: y / Math.max(1, height),
          centerScore: centerWeightFor(x, y, width, height),
          objectConfidence: borderLike ? 0.35 : 0.55,
          inObject: !borderLike,
        });
      }
    }
  }
  samples.meta = {
    backgroundRatio: objectMask.backgroundRatio,
    ignoredSoleRatio: objectMask.ignoredSoleRatio,
    objectPixelCount: objectMask.objectPixelCount || samples.length,
  };
  return samples;
};

const averageColor = (items) => {
  const total = items.reduce(
    (acc, item) => ({
      r: acc.r + item.r * (item.weight || 1),
      g: acc.g + item.g * (item.weight || 1),
      b: acc.b + item.b * (item.weight || 1),
      weight: acc.weight + (item.weight || 1),
    }),
    { r: 0, g: 0, b: 0, weight: 0 }
  );
  return {
    r: total.r / total.weight,
    g: total.g / total.weight,
    b: total.b / total.weight,
  };
};

const totalSampleWeight = (samples) => samples.reduce((sum, sample) => sum + (sample.weight || 1), 0);

const initializeCentroids = (samples, count) => {
  const sorted = [...samples].sort((a, b) => rgbToHsl(a).h - rgbToHsl(b).h || rgbToHsl(a).l - rgbToHsl(b).l);
  return Array.from({ length: count }, (_, index) => sorted[Math.floor((sorted.length - 1) * (index / Math.max(1, count - 1)))] || samples[0]);
};

const clusterSamples = (samples, count = 3) => {
  let centroids = initializeCentroids(samples, Math.min(count, samples.length));
  let groups = [];
  const totalWeight = totalSampleWeight(samples);
  for (let pass = 0; pass < 8; pass += 1) {
    groups = centroids.map((centroid) => ({ centroid, samples: [] }));
    for (const sample of samples) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      centroids.forEach((centroid, index) => {
        const distance = colorDistance(sample, centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      groups[bestIndex].samples.push(sample);
    }
    centroids = groups.map((group) => (group.samples.length ? averageColor(group.samples) : group.centroid));
  }
  return groups
    .map((group, index) => {
      const weight = totalSampleWeight(group.samples);
      const borderWeight = group.samples.reduce((sum, sample) => sum + (sample.borderLike ? sample.weight || 1 : 0), 0);
      const backgroundWeight = group.samples.reduce((sum, sample) => sum + (sample.backgroundLike ? sample.weight || 1 : 0), 0);
      const soleWeight = group.samples.reduce((sum, sample) => sum + (sample.soleLike ? sample.weight || 1 : 0), 0);
      const centerScore =
        group.samples.reduce((sum, sample) => sum + (sample.centerScore || 1) * (sample.weight || 1), 0) / Math.max(weight, 0.001);
      const objectConfidence =
        group.samples.reduce((sum, sample) => sum + (sample.objectConfidence || 0.6) * (sample.weight || 1), 0) /
        Math.max(weight, 0.001);
      const score = (weight / totalWeight) * centerScore * objectConfidence * (1 - Math.min(0.65, soleWeight / Math.max(weight, 0.001) * 0.75));
      return {
        rgb: centroids[index],
        count: group.samples.length,
        weight,
        share: weight / totalWeight,
        borderShare: weight ? borderWeight / weight : 0,
        backgroundShare: weight ? backgroundWeight / weight : 0,
        soleShare: weight ? soleWeight / weight : 0,
        centerScore,
        objectConfidence,
        score,
      };
    })
    .filter((group) => group.count > 0)
    .sort((a, b) => b.score - a.score);
};

const areDifferentEnough = (primary, secondary) => {
  if (!secondary || secondary.share < 0.22) return false;
  if (secondary.share / Math.max(primary.share, 0.001) < 0.35) return false;
  if (primary.name === secondary.name) return false;
  if (secondary.borderShare > 0.46 || secondary.backgroundShare > 0.34) return false;
  if (secondary.name === "White" || secondary.name === "Off White" || secondary.name === "Cream") {
    if (secondary.share < 0.24 || secondary.borderShare > 0.35 || secondary.backgroundShare > 0.22 || secondary.soleShare > 0.42) return false;
  }
  return colorDistance(primary.rgb, secondary.rgb) > 0.16;
};

const isOrangeSecondaryCluster = (cluster) => {
  if (!cluster || cluster.share < 0.08) return false;
  const hsl = rgbToHsl(cluster.rgb);
  return (
    hsl.h >= 20 &&
    hsl.h <= 45 &&
    hsl.s >= 0.35 &&
    cluster.centerScore >= 0.55 &&
    cluster.objectConfidence >= 0.45 &&
    cluster.backgroundShare <= 0.34 &&
    cluster.borderShare <= 0.46
  );
};

const selectSecondaryCluster = (primary, clusters, stats) => {
  const secondary = suppressWeakWhiteSecondary(primary, clusters.slice(1).find((cluster) => areDifferentEnough(primary, cluster)), stats);
  if (secondary) {
    return isOrangeSecondaryCluster(secondary) ? { ...secondary, name: "Orange" } : secondary;
  }
  if (primary.name !== "Black") return null;
  const orange = clusters.slice(1).find((cluster) => isOrangeSecondaryCluster(cluster));
  return orange ? { ...orange, name: "Orange" } : null;
};

const getSampleStats = (samples) => {
  const weighted = averageColor(samples);
  const avgHsl = rgbToHsl(weighted);
  const brightnessValues = samples.map((sample) => brightnessOf(sample));
  const avgBrightness = brightnessOf(weighted);
  const variance =
    brightnessValues.reduce((sum, value) => sum + (value - avgBrightness) ** 2, 0) / Math.max(1, brightnessValues.length);
  const totalWeight = totalSampleWeight(samples);
  const weightedRatio = (predicate) =>
    samples.reduce((sum, sample) => sum + (predicate(sample) ? sample.weight || 1 : 0), 0) / Math.max(totalWeight, 0.001);
  const nearWhiteRatio = weightedRatio((sample) => isNearWhite(sample) || (brightnessOf(sample) >= 215 && rgbToHsl(sample).s <= 0.18));
  const greyRatio = weightedRatio((sample) => {
    const hsl = rgbToHsl(sample);
    const brightness = brightnessOf(sample);
    return hsl.s <= 0.16 && brightness >= 80 && brightness < 215;
  });
  const blackRatio = weightedRatio((sample) => isNearBlack(sample) || brightnessOf(sample) < 55);
  const darkObjectRatio = weightedRatio((sample) => brightnessOf(sample) < 85 && sample.inObject);
  const neutralRatio = weightedRatio(isNeutralPixel);
  const highlightRatio = weightedRatio((sample) => brightnessOf(sample) >= 232 && rgbToHsl(sample).s <= 0.18);
  const midShadowRatio = weightedRatio((sample) => {
    const brightness = brightnessOf(sample);
    return brightness >= 70 && brightness <= 150 && rgbToHsl(sample).s <= 0.18;
  });
  const metallicContrast = Math.sqrt(variance) >= 30 && highlightRatio >= 0.035 && midShadowRatio >= 0.14 && neutralRatio >= 0.68;
  return {
    avgRgb: weighted,
    avgHsl,
    avgBrightness,
    brightnessStdDev: Math.sqrt(variance),
    nearWhiteRatio,
    greyRatio,
    blackRatio,
    whiteRatio: nearWhiteRatio,
    darkObjectRatio,
    backgroundRatio: samples.meta?.backgroundRatio || 0,
    ignoredSoleRatio: samples.meta?.ignoredSoleRatio || 0,
    objectPixelCount: samples.meta?.objectPixelCount || samples.length,
    metallicContrast,
  };
};

const neutralNameFor = (rgb, stats) => {
  const hsl = rgbToHsl(rgb);
  const brightness = brightnessOf(rgb);
  if (brightness >= 215 && hsl.s <= 0.18) return "White";
  if (brightness >= 195 && hsl.s <= 0.22 && isWarmNeutral(rgb)) return brightness >= 208 ? "Off White" : "Cream";
  if (brightness >= 145 && brightness <= 220 && hsl.s <= 0.16) {
    if (stats.metallicContrast && stats.nearWhiteRatio <= 0.45) return "Silver";
    return brightness > 205 ? "White" : "Grey";
  }
  if (brightness > 205 && hsl.s <= 0.2) return "White";
  return "";
};

const applyNeutralCorrections = (cluster, stats) => {
  const correctedName = neutralNameFor(cluster.rgb, stats);
  let name = correctedName || cluster.name;
  if (name === "Silver" && stats.nearWhiteRatio > 0.45) name = "White";
  if ((name === "Grey" || name === "Silver") && stats.avgBrightness > 205) name = "White";
  if (name === "Silver" && rgbToHsl(cluster.rgb).s <= 0.05 && !stats.metallicContrast) {
    name = stats.avgBrightness >= 205 ? "White" : "Grey";
  }
  return { ...cluster, name };
};

const DARK_PRIORITY_NAMES = new Set(["Black", "Navy", "Brown", "Burgundy"]);
const LIGHT_NEUTRAL_NAMES = new Set(["White", "Off White", "Cream"]);

const promoteDarkPrimaryWhenNeeded = (clusters, stats) => {
  if (stats.darkObjectRatio <= 0.32 && !(clusters[0] && LIGHT_NEUTRAL_NAMES.has(clusters[0].name) && stats.blackRatio > stats.whiteRatio * 0.75)) {
    return clusters;
  }
  const darkIndex = clusters.findIndex((cluster) => DARK_PRIORITY_NAMES.has(cluster.name) || brightnessOf(cluster.rgb) < 78);
  if (darkIndex <= 0) return clusters;
  const darkCluster = clusters[darkIndex];
  const primary = clusters[0];
  const whitePrimaryBlocked = LIGHT_NEUTRAL_NAMES.has(primary.name) && stats.blackRatio > stats.whiteRatio * 0.75;
  const darkHasObjectEvidence =
    darkCluster.share >= 0.18 &&
    darkCluster.centerScore >= 0.62 &&
    darkCluster.objectConfidence >= 0.62 &&
    darkCluster.backgroundShare < 0.2 &&
    darkCluster.borderShare < 0.45;
  if (!whitePrimaryBlocked && darkCluster.share < 0.26) return clusters;
  if (LIGHT_NEUTRAL_NAMES.has(primary.name) && !darkHasObjectEvidence) return clusters;
  const next = clusters.filter((_, index) => index !== darkIndex);
  return [darkCluster, ...next];
};

const suppressWeakWhiteSecondary = (primary, secondary, stats) => {
  if (!secondary || !LIGHT_NEUTRAL_NAMES.has(secondary.name)) return secondary;
  if (DARK_PRIORITY_NAMES.has(primary.name) || brightnessOf(primary.rgb) < 90) {
    const secondaryToPrimary = secondary.share / Math.max(primary.share, 0.001);
    if (secondary.soleShare > 0.3) return null;
    if (stats.darkObjectRatio > 0.32 && secondary.share < 0.38) return null;
    if (stats.darkObjectRatio > 0.32 && secondaryToPrimary < 0.55) return null;
    if (stats.blackRatio > stats.whiteRatio * 0.75 && secondary.share < 0.42) return null;
  }
  return secondary;
};

const analyzeImage = async (source) => {
  if (!source) throw new Error("Image source is required");
  const canvasPixels = await getCanvasPixels(source);
  const samples = collectSamples(canvasPixels);
  if (!samples.length) throw new Error("No visible pixels found");
  const stats = getSampleStats(samples);

  const clusters = promoteDarkPrimaryWhenNeeded(clusterSamples(samples, 3)
    .filter((cluster) => cluster.share >= 0.08)
    .slice(0, 3)
    .map((cluster) => {
      const nearest = fashionColorNameFor(cluster.rgb);
      return {
        ...cluster,
        name: nearest.name,
        distance: nearest.distance,
        hex: rgbToHex(cluster.rgb),
      };
    })
    .map((cluster) => applyNeutralCorrections(cluster, stats)), stats);

  const primary = clusters[0];
  if (!primary) throw new Error("No dominant color found");
  const secondary = selectSecondaryCluster(primary, clusters, stats);
  const confidence = clamp(primary.share * 0.72 + (1 - primary.distance) * 0.28, 0.05, 0.99);

  return {
    primary,
    secondary,
    confidence,
    stats,
    advanced: {
      primaryRatio: primary.share,
      secondaryRatio: secondary?.share || 0,
      backgroundRatio: stats.backgroundRatio,
      objectPixelCount: stats.objectPixelCount,
    },
  };
};

/*
Detection reference cases:
- all white shoe => White
- black shoe on white background => Black
- black shoe with small white sole/logo => Black
- true black/white shoe with large areas => Black + White
- beige/off-white shoe => Off White or Beige
- grey shoe => Grey
- metallic shoe => Silver only with metallic evidence
- black/orange sneaker => Black + Orange
- black sneaker with cool shadow => Black
- true navy shoe => Navy
*/

export async function colorNameFromImage(source) {
  return colorNameFromImageSmart(source);
}

export async function colorNameFromImagePoint(input, point) {
  if (!input) throw new Error("Image source is required");
  const canvasPixels = await getCanvasPixels(input);
  const samples = sampleCircleFromCanvas(canvasPixels, point);
  if (!samples.length) throw new Error("No visible pixels found near selected point");
  const rgb = medianAverageColor(samples);
  const nearWhiteRatio = samples.filter((sample) => isNearWhite(sample) || (brightnessOf(sample) >= 215 && rgbToHsl(sample).s <= 0.18)).length / samples.length;
  const name = nameForSampledRgb(rgb, { nearWhiteRatio });
  const hsl = rgbToHsl(rgb);
  const confidence = 0.62 + Math.min(0.28, samples.length / 260) + (hsl.s > 0.18 || brightnessOf(rgb) < 110 ? 0.06 : 0);
  return colorResult({ name, rgb, confidence });
}

export async function colorNameFromImageSmart(input) {
  if (!input) throw new Error("Image source is required");
  const canvasPixels = await getCanvasPixels(input);
  const background = estimateBackgroundColor(canvasPixels);
  const floodBackground = floodFillBackground(canvasPixels, background);
  const points = [0.38, 0.45, 0.52, 0.58].flatMap((yRatio) => [0.35, 0.45, 0.55, 0.65].map((xRatio) => ({ xRatio, yRatio })));
  const candidates = [];

  for (const point of points) {
    const x = clamp(Math.round(point.xRatio * (canvasPixels.width - 1)), 0, canvasPixels.width - 1);
    const y = clamp(Math.round(point.yRatio * (canvasPixels.height - 1)), 0, canvasPixels.height - 1);
    if (point.yRatio > 0.7) continue;
    const centerPixel = pixelFromData(canvasPixels.data, (y * canvasPixels.width + x) * 4);
    if (isTransparent(centerPixel.a) || floodBackground[y * canvasPixels.width + x] || isCloseToBackground(centerPixel, background)) continue;

    const samples = sampleCircleFromCanvas(canvasPixels, point, {
      background,
      floodBackground,
      ignoreNearWhiteBackground: true,
    });
    if (samples.length < 12) continue;
    const rgb = medianAverageColor(samples);
    const hsl = rgbToHsl(rgb);
    const brightness = brightnessOf(rgb);
    const nearWhiteRatio = samples.filter((sample) => isNearWhite(sample) || (brightnessOf(sample) >= 215 && rgbToHsl(sample).s <= 0.18)).length / samples.length;
    const name = nameForSampledRgb(rgb, { nearWhiteRatio });
    const darkScore = brightness < 95 ? 1.2 : brightness < 125 ? 0.8 : 0;
    const saturationScore = hsl.s > 0.2 ? hsl.s * 0.8 : 0;
    const whitePenalty = LIGHT_NEUTRAL_NAMES.has(name) ? 0.55 + nearWhiteRatio * 0.55 : 0;
    const bodyScore = centerWeightFor(x, y, canvasPixels.width, canvasPixels.height) + (point.yRatio <= 0.58 ? 0.2 : 0);
    const score = bodyScore + darkScore + saturationScore - whitePenalty;
    candidates.push({ rgb, name, score, brightness, saturation: hsl.s, nearWhiteRatio });
  }

  if (candidates.length) {
    const darkCandidate = candidates
      .filter((candidate) => candidate.brightness < 125 && !LIGHT_NEUTRAL_NAMES.has(candidate.name))
      .sort((a, b) => b.score - a.score)[0];
    const best = (darkCandidate || candidates.sort((a, b) => b.score - a.score)[0]);
    if (best.name === "Black") {
      const analyzed = await analyzeImage(input);
      if (analyzed.primary.name === "Black" && analyzed.secondary?.name === "Orange") {
        return {
          name: analyzed.primary.name,
          secondaryName: analyzed.secondary.name,
          label: `${analyzed.primary.name} + ${analyzed.secondary.name}`,
          hex: analyzed.primary.hex,
          secondaryHex: analyzed.secondary.hex,
          confidence: Number(analyzed.confidence.toFixed(2)),
        };
      }
    }
    return colorResult({
      name: best.name,
      rgb: best.rgb,
      confidence: 0.72 + Math.min(0.18, Math.max(0, best.score) * 0.04),
    });
  }

  const { primary, secondary, confidence } = await analyzeImage(input);
  if (LIGHT_NEUTRAL_NAMES.has(primary.name)) {
    const darkFallback = [primary, secondary].find((cluster) => cluster && (brightnessOf(cluster.rgb) < 125 || DARK_PRIORITY_NAMES.has(cluster.name)));
    if (darkFallback && darkFallback.share >= 0.16) {
      return colorResult({ name: darkFallback.name, rgb: darkFallback.rgb, confidence: Math.max(0.68, confidence) });
    }
  }
  return {
    name: primary.name,
    secondaryName: secondary?.name || "",
    label: secondary ? `${primary.name} + ${secondary.name}` : primary.name,
    hex: primary.hex,
    secondaryHex: secondary?.hex || "",
    confidence: Number(confidence.toFixed(2)),
  };
}

export async function debugColorDetection(input) {
  const { primary, secondary, stats, advanced } = await analyzeImage(input);
  return {
    nearWhiteRatio: Number(stats.nearWhiteRatio.toFixed(3)),
    greyRatio: Number(stats.greyRatio.toFixed(3)),
    blackRatio: Number(stats.blackRatio.toFixed(3)),
    primaryRatio: Number(advanced.primaryRatio.toFixed(3)),
    secondaryRatio: Number(advanced.secondaryRatio.toFixed(3)),
    backgroundRatio: Number(advanced.backgroundRatio.toFixed(3)),
    objectPixelCount: advanced.objectPixelCount,
    avgRgb: {
      r: Math.round(stats.avgRgb.r),
      g: Math.round(stats.avgRgb.g),
      b: Math.round(stats.avgRgb.b),
    },
    avgHsl: {
      h: Math.round(stats.avgHsl.h),
      s: Number(stats.avgHsl.s.toFixed(3)),
      l: Number(stats.avgHsl.l.toFixed(3)),
    },
    dominantHex: primary.hex,
    label: secondary ? `${primary.name} + ${secondary.name}` : primary.name,
  };
}

const renderSegmentationPreview = ({ width, height, mask, floodBackground, soleMask }) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (soleMask?.[index]) {
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 204;
      imageData.data[offset + 2] = 0;
      imageData.data[offset + 3] = 255;
    } else if (mask?.[index]) {
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = 255;
    } else if (floodBackground?.[index]) {
      imageData.data[offset] = 64;
      imageData.data[offset + 1] = 96;
      imageData.data[offset + 2] = 160;
      imageData.data[offset + 3] = 190;
    } else {
      imageData.data[offset] = 0;
      imageData.data[offset + 1] = 0;
      imageData.data[offset + 2] = 0;
      imageData.data[offset + 3] = 120;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};

const renderClusterMap = (canvasPixels, segmentation, clusters) => {
  const { data, width, height } = canvasPixels;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (!segmentation.mask[index]) {
      imageData.data[offset + 3] = 0;
      continue;
    }
    const pixel = pixelFromData(data, offset);
    const nearest = clusters.reduce(
      (best, cluster) => {
        const distance = colorDistance(pixel, cluster.rgb);
        return distance < best.distance ? { cluster, distance } : best;
      },
      { cluster: clusters[0], distance: Infinity }
    ).cluster;
    imageData.data[offset] = clamp(Math.round(nearest.rgb.r), 0, 255);
    imageData.data[offset + 1] = clamp(Math.round(nearest.rgb.g), 0, 255);
    imageData.data[offset + 2] = clamp(Math.round(nearest.rgb.b), 0, 255);
    imageData.data[offset + 3] = segmentation.soleMask[index] ? 135 : 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};

export async function debugSegmentation(image) {
  const canvasPixels = await getCanvasPixels(image);
  const background = estimateBackgroundColor(canvasPixels);
  const segmentation = buildObjectMask(canvasPixels, background);
  const samples = collectSamples(canvasPixels);
  const clusters = clusterSamples(samples, 3);
  return {
    objectMaskPreview: renderSegmentationPreview({
      width: canvasPixels.width,
      height: canvasPixels.height,
      mask: segmentation.mask,
      floodBackground: segmentation.floodBackground,
      soleMask: segmentation.soleMask,
    }),
    ignoredBackgroundPercent: Number((segmentation.backgroundRatio * 100).toFixed(1)),
    ignoredSolePercent: Number((segmentation.ignoredSoleRatio * 100).toFixed(1)),
    dominantClusterMap: renderClusterMap(canvasPixels, segmentation, clusters),
  };
}

export default colorNameFromImage;
