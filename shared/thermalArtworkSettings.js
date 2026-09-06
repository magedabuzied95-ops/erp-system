/**
 * Thermal artwork settings shared by the settings registry, the API and the
 * local rendering engine, so the option lists can never drift apart.
 */

export const THERMAL_ARTWORK_ENGINES = Object.freeze(["local", "openai"]);

export const THERMAL_ARTWORK_STYLES = Object.freeze(["auto", "diffusion", "lineart", "sketch", "detail", "halftone", "outline", "silhouette"]);

/**
 * "auto" is not a drawing style — it measures how dark the product is and picks
 * between line art and halftone per photo. A black shoe drawn as line art
 * collapses to an empty outline at 203 dpi, and a white one drawn as halftone
 * clumps; nobody wants to make that call product by product.
 */
export const THERMAL_ARTWORK_AUTO_STYLE = "auto";

export const THERMAL_ARTWORK_DEFAULTS = Object.freeze({
  engine: "local",
  style: "auto",
  inkLevel: 50,
});

export const THERMAL_ARTWORK_SETTING_KEYS = Object.freeze({
  engine: "general.barcode_print_thermal_engine",
  style: "general.barcode_print_thermal_style",
  inkLevel: "general.barcode_print_thermal_ink_level",
});

export const normalizeThermalEngine = (value) => {
  const engine = String(value || "").trim().toLowerCase();
  return THERMAL_ARTWORK_ENGINES.includes(engine) ? engine : THERMAL_ARTWORK_DEFAULTS.engine;
};

export const normalizeThermalStyle = (value) => {
  const style = String(value || "").trim().toLowerCase();
  return THERMAL_ARTWORK_STYLES.includes(style) ? style : THERMAL_ARTWORK_DEFAULTS.style;
};

export const normalizeThermalInkLevel = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return THERMAL_ARTWORK_DEFAULTS.inkLevel;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

export default {
  THERMAL_ARTWORK_ENGINES,
  THERMAL_ARTWORK_STYLES,
  THERMAL_ARTWORK_AUTO_STYLE,
  THERMAL_ARTWORK_DEFAULTS,
  THERMAL_ARTWORK_SETTING_KEYS,
  normalizeThermalEngine,
  normalizeThermalStyle,
  normalizeThermalInkLevel,
};
