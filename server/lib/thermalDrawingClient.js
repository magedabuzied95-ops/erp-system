/**
 * Client for the drawing service (server/artwork-service): Stable Diffusion
 * guided by ControlNet Lineart, running on this box. The backend sends the
 * line map it already has and gets back a grey PNG of the redrawn product.
 *
 * The service is optional. Availability is probed through /health and cached
 * briefly, so a box without the container — or with the model still loading —
 * falls straight back to the local line-drawing style without a wait.
 */

const DEFAULT_URL = "http://erp-artwork:8000";
const HEALTH_TTL_MS = 30_000;
const DRAW_TIMEOUT_MS = Number(process.env.THERMAL_DRAWING_TIMEOUT_MS || 600_000);

let healthCache = { at: 0, ok: false, detail: null };

export const drawingServiceUrl = () => String(process.env.THERMAL_DRAWING_SERVICE_URL || DEFAULT_URL).replace(/\/+$/, "");

export const isDrawingServiceEnabled = () => {
  const flag = String(process.env.THERMAL_DRAWING_SERVICE || "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(flag);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** True only when the service answers and reports its model loaded. */
export const isDrawingServiceReady = async ({ force = false } = {}) => {
  if (!isDrawingServiceEnabled()) return false;
  if (!force && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.ok;
  try {
    const response = await fetchWithTimeout(`${drawingServiceUrl()}/health`, {}, 5_000);
    const body = response.ok ? await response.json() : null;
    healthCache = { at: Date.now(), ok: Boolean(body?.ok && body?.loaded), detail: body };
  } catch (error) {
    healthCache = { at: Date.now(), ok: false, detail: { error: error?.message || String(error) } };
  }
  return healthCache.ok;
};

export const drawingServiceStatus = () => ({ ...healthCache, url: drawingServiceUrl(), enabled: isDrawingServiceEnabled() });

/**
 * Ask the service to redraw a product from its line map.
 *
 * @param {object} options
 * @param {Buffer} options.controlPng  PNG of the line map, black lines on white
 * @returns {Promise<{ png: Buffer, width: number, height: number, ms: number }>}
 */
export const drawFromLineart = async ({ controlPng, prompt, negativePrompt, steps, guidance, controlnetScale, seed = 1, maxSide } = {}) => {
  if (!controlPng?.length) throw new Error("drawing service needs a control image");
  const body = {
    control: Buffer.from(controlPng).toString("base64"),
    seed,
    invert_control: true,
  };
  if (prompt) body.prompt = prompt;
  if (negativePrompt) body.negative_prompt = negativePrompt;
  if (steps) body.steps = steps;
  if (guidance !== undefined) body.guidance = guidance;
  if (controlnetScale !== undefined) body.controlnet_scale = controlnetScale;
  if (maxSide) body.max_side = maxSide;

  const response = await fetchWithTimeout(
    `${drawingServiceUrl()}/draw`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    DRAW_TIMEOUT_MS
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`drawing service ${response.status}: ${text.slice(0, 300)}`);
  }
  const result = await response.json();
  if (!result?.image) throw new Error("drawing service returned no image");
  return {
    png: Buffer.from(result.image, "base64"),
    width: Number(result.width || 0),
    height: Number(result.height || 0),
    ms: Number(result.ms || 0),
  };
};

export default { drawingServiceUrl, isDrawingServiceEnabled, isDrawingServiceReady, drawingServiceStatus, drawFromLineart };
