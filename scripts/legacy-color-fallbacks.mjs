/* ============================================================================
   LEGACY COLOUR FALLBACKS — keep the UI painted on pre-2023 mobile engines
   ----------------------------------------------------------------------------
   Three modern colour features are load-bearing in the shipped stylesheet and
   none of them degrades on its own:

   * `oklch()` — Tailwind v4 writes its whole default palette that way (177
     `--color-*` variables). A browser that cannot parse it still STORES the
     custom property (custom properties accept any token sequence), so the
     failure only shows up at the point of use: `background-color:
     var(--color-red-500)` becomes invalid at computed-value time and the
     property resets to `unset`. Result on Chrome < 111 / Safari < 15.4:
     `bg-red-500` paints nothing and `text-slate-700` inherits whatever is
     above it. Because the value is stored, a *preceding* declaration cannot
     rescue it — only an `@supports` override can.

   * `oklab()` — 215 literals, the way Tailwind renders an opacity modifier on
     an arbitrary colour (`border-[#d4af37]/18`). Unguarded, and on real
     properties, so a plain declaration in front of each is enough.

   * `color-mix()` — 190 uses of ours are unguarded (Tailwind guards its own
     1,341 `in oklab` mixes and they degrade to full opacity). On a real
     property an unsupported declaration is dropped at parse time, so a plain
     declaration written just before it survives. On a custom property it is
     the `@supports` route again.

   So this rewrites the built CSS: a static fallback declaration in front of
   every affected real property, and one appended `@supports not (…)` block per
   rule for the custom properties. Both are skipped inside an existing
   `@supports`, which is what leaves Tailwind's already-guarded output alone.

   It runs on the BUNDLE rather than on source so it also covers what Tailwind
   generates, and so no one has to remember the pattern at 190 call sites.
   ========================================================================== */

const OKLCH_PROBE = "(color: oklch(0% 0 0))";
const OKLAB_PROBE = "(color: oklab(0% 0 0))";
const COLOR_MIX_PROBE = "(color: color-mix(in srgb, red 50%, blue))";

/* -------------------------------------------------------------------------
   oklch() → sRGB
   Oklab matrices from Björn Ottosson's reference conversion. Out-of-gamut
   colours are clipped per channel, which is what Lightning CSS does for the
   same job — a hair off for the most saturated swatches, and invisible next to
   the alternative of no colour at all.
   ------------------------------------------------------------------------ */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

const gamma = (channel) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;

const channelHex = (channel) =>
  Math.round(clamp01(channel) * 255)
    .toString(16)
    .padStart(2, "0");

export function oklchToSrgb(lightness, chroma, hue, alpha = 1) {
  const hueRadians = (hue * Math.PI) / 180;
  return oklabToSrgb(lightness, chroma * Math.cos(hueRadians), chroma * Math.sin(hueRadians), alpha);
}

export function oklabToSrgb(lightness, a, b, alpha = 1) {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const red = gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

  if (alpha >= 1) return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}`;
  const round255 = (channel) => Math.round(clamp01(channel) * 255);
  return `rgba(${round255(red)}, ${round255(green)}, ${round255(blue)}, ${Number(alpha.toFixed(3))})`;
}

const readNumber = (token, { asRatio = false } = {}) => {
  const text = String(token || "").trim();
  if (!text || text === "none") return 0;
  if (text.endsWith("%")) {
    const value = Number.parseFloat(text);
    return Number.isFinite(value) ? (asRatio ? value / 100 : value) : 0;
  }
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : 0;
};

/* -------------------------------------------------------------------------
   Balanced-paren helpers. CSS values nest (a mix inside a gradient inside a
   shadow), so nothing here may use a flat regex.
   ------------------------------------------------------------------------ */

export function splitTopLevel(value, separator = ",") {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      current += char;
      if (char === "\\") {
        current += value[index + 1] ?? "";
        index += 1;
      } else if (char === quote) quote = "";
      continue;
    }
    if (char === "\\") {
      current += char + (value[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

// Returns the index just past the ")" that closes the "(" at openIndex.
const closingParen = (value, openIndex) => {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
};

const findCall = (value, name, from = 0) => {
  let index = value.indexOf(name, from);
  while (index !== -1) {
    // Reject a match that is the tail of a longer ident, e.g. `--my-oklch(`.
    const before = index === 0 ? "" : value[index - 1];
    if (!/[\w-]/.test(before)) return index;
    index = value.indexOf(name, index + 1);
  }
  return -1;
};

/* -------------------------------------------------------------------------
   color-mix() → the colour it mostly is
   ------------------------------------------------------------------------ */

const splitColorAndPercentage = (component) => {
  const text = component.trim();
  const match = text.match(/\s([\d.]+)%$/);
  if (match) return { color: text.slice(0, match.index).trim(), percentage: Number.parseFloat(match[1]) };
  const leading = text.match(/^([\d.]+)%\s/);
  if (leading) return { color: text.slice(leading[0].length).trim(), percentage: Number.parseFloat(leading[1]) };
  return { color: text, percentage: null };
};

// themes.js defines a `-soft` variant of each semantic colour precisely for
// low-intensity fills, so an accent wash has a real designed answer.
const SOFT_ACCENTS = new Set(["primary", "success", "warning", "danger", "info"]);
const PAINTS_A_SURFACE = /^(background|background-color|background-image|--.*-(bg|background|fill))$/;

const softVariantOf = (color) => {
  const token = /^var\(\s*--([a-z-]+)\s*\)$/i.exec(String(color).trim());
  if (!token || !SOFT_ACCENTS.has(token[1].toLowerCase())) return null;
  return `var(--${token[1]}-soft, transparent)`;
};

export function colorMixFallback(args, property = "") {
  const parts = splitTopLevel(args).map((part) => part.trim());
  // parts[0] is the colour space ("in srgb", "in oklab shorter hue", …).
  const colors = parts.slice(1).filter(Boolean);
  if (colors.length === 0) return null;
  if (colors.length === 1) return splitColorAndPercentage(colors[0]).color;

  const first = splitColorAndPercentage(colors[0]);
  const second = splitColorAndPercentage(colors[1]);

  // A mix into `transparent` is an opacity wash. Tailwind's own guarded output
  // degrades those to the FULL-strength colour, and for a border, a ring, an
  // underline or text that is right — those have to stay visible and never sit
  // behind text. As a *surface* it is not: an 8% primary glow becoming solid
  // gold puts dark text on gold. There the designed answer is the `-soft`
  // variant, and where the token has none the wash simply does not paint —
  // which is what the browser does today, so never worse.
  const wash = /^transparent$/i.test(second.color)
    ? first.color
    : /^transparent$/i.test(first.color)
      ? second.color
      : null;
  if (wash !== null) {
    if (!PAINTS_A_SURFACE.test(property)) return wash;
    return softVariantOf(wash) ?? wash;
  }

  const firstShare = first.percentage ?? (second.percentage === null ? 50 : 100 - second.percentage);
  const secondShare = second.percentage ?? 100 - firstShare;
  return firstShare >= secondShare ? first.color : second.color;
}

/* -------------------------------------------------------------------------
   Value rewriting
   ------------------------------------------------------------------------ */

const replaceOklch = (value) => {
  let result = value;
  let cursor = 0;
  for (;;) {
    const start = findCall(result, "oklch(", cursor);
    if (start === -1) return result;
    const end = closingParen(result, start + "oklch".length);
    if (end === -1) return result;
    const inner = result.slice(start + "oklch(".length, end - 1);
    const [coordinates, alphaText] = splitTopLevel(inner, "/");
    const [lightness, chroma, hue] = coordinates.trim().split(/\s+/);
    // A var() anywhere inside cannot be resolved at build time — leave it.
    if (inner.includes("var(")) {
      cursor = end;
      continue;
    }
    const replacement = oklchToSrgb(
      readNumber(lightness, { asRatio: true }),
      readNumber(chroma),
      readNumber(hue),
      alphaText === undefined ? 1 : readNumber(alphaText, { asRatio: true })
    );
    result = result.slice(0, start) + replacement + result.slice(end);
    cursor = start + replacement.length;
  }
};

// Tailwind writes an opacity modifier on an ARBITRARY colour as a literal
// oklab: `border-[#d4af37]/18` ships as `oklab(76.6528% -.002 .138 / .18)`.
// Unlike the palette these are on real properties, so a plain declaration in
// front of them is all they need — but they are the single biggest group.
const replaceOklab = (value) => {
  let result = value;
  let cursor = 0;
  for (;;) {
    const start = findCall(result, "oklab(", cursor);
    if (start === -1) return result;
    const end = closingParen(result, start + "oklab".length);
    if (end === -1) return result;
    const inner = result.slice(start + "oklab(".length, end - 1);
    if (inner.includes("var(")) {
      cursor = end;
      continue;
    }
    const [coordinates, alphaText] = splitTopLevel(inner, "/");
    const [lightness, a, b] = coordinates.trim().split(/\s+/);
    const replacement = oklabToSrgb(
      readNumber(lightness, { asRatio: true }),
      readNumber(a),
      readNumber(b),
      alphaText === undefined ? 1 : readNumber(alphaText, { asRatio: true })
    );
    result = result.slice(0, start) + replacement + result.slice(end);
    cursor = start + replacement.length;
  }
};

const replaceColorMix = (value, property) => {
  let result = value;
  let cursor = 0;
  for (;;) {
    const start = findCall(result, "color-mix(", cursor);
    if (start === -1) return result;
    const end = closingParen(result, start + "color-mix".length);
    if (end === -1) return result;
    const inner = result.slice(start + "color-mix(".length, end - 1);
    // Innermost first, so a mix of mixes collapses cleanly.
    const resolvedInner = replaceColorMix(inner, property);
    const fallback = colorMixFallback(resolvedInner, property);
    if (fallback === null) {
      cursor = end;
      continue;
    }
    result = result.slice(0, start) + fallback + result.slice(end);
    cursor = start + fallback.length;
  }
};

export function fallbackValue(value, features, property = "") {
  let result = value;
  if (features.oklch) result = replaceOklch(result);
  if (features.oklab) result = replaceOklab(result);
  if (features.colorMix) result = replaceColorMix(result, property);
  return result;
}

export function supportsCondition(features) {
  const probes = [];
  if (features.oklch) probes.push(`not ${OKLCH_PROBE}`);
  if (features.oklab) probes.push(`not ${OKLAB_PROBE}`);
  if (features.colorMix) probes.push(`not ${COLOR_MIX_PROBE}`);
  return probes.join(" or ");
}

/* -------------------------------------------------------------------------
   The stylesheet pass
   ------------------------------------------------------------------------ */

const featuresIn = (value) => ({
  oklch: findCall(value, "oklch(") !== -1,
  oklab: findCall(value, "oklab(") !== -1,
  colorMix: findCall(value, "color-mix(") !== -1,
});

const usesAnyFeature = (features) => features.oklch || features.oklab || features.colorMix;

const splitDeclaration = (text) => {
  const colon = text.indexOf(":");
  if (colon === -1) return null;
  const property = text.slice(0, colon).trim();
  if (!property || property.startsWith("@")) return null;
  let value = text.slice(colon + 1).trim();
  let important = false;
  const importantMatch = value.match(/!\s*important\s*$/i);
  if (importantMatch) {
    important = true;
    value = value.slice(0, importantMatch.index).trim();
  }
  return { property, value, important };
};

/**
 * One tokenizer for both passes. `onDeclaration` receives every declaration
 * with the at-rule/selector stack it sits in and returns the text to emit in
 * its place, so the rewrite and the audit can never disagree about structure.
 */
export function walkStylesheet(css, onDeclaration) {
  const source = String(css);
  const stack = [];
  let out = "";
  let buffer = "";

  const flush = (terminator) => {
    const text = buffer;
    buffer = "";
    out += onDeclaration({ text, stack, terminator }) ?? text + terminator;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      const stop = close === -1 ? source.length : close + 2;
      buffer += source.slice(index, stop);
      index = stop - 1;
      continue;
    }
    // A CSS escape binds tighter than anything else, INCLUDING quotes. Tailwind
    // writes arbitrary values straight into the selector, so the stylesheet
    // really does contain `.font-\[\'Cairo\'\,...\]` — read those `\'` as string
    // delimiters and the brace stack desynchronises for the whole rest of the
    // file. Not hypothetical: it happened here, and it silently moved every
    // rule after byte 442,932 of the entry stylesheet into the wrong context.
    if (char === "\\") {
      buffer += char + (source[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      let stop = index + 1;
      while (stop < source.length) {
        if (source[stop] === "\\") stop += 2;
        else if (source[stop] === char) break;
        else stop += 1;
      }
      buffer += source.slice(index, stop + 1);
      index = stop;
      continue;
    }
    if (char === "{") {
      stack.push(buffer.trim());
      out += buffer + "{";
      buffer = "";
      continue;
    }
    if (char === ";") {
      flush(";");
      continue;
    }
    if (char === "}") {
      if (buffer.trim()) flush("");
      else {
        out += buffer;
        buffer = "";
      }
      out += "}";
      stack.pop();
      continue;
    }
    buffer += char;
  }
  return out + buffer;
}

const inStyleRule = (stack) => stack.length > 0 && !stack[stack.length - 1].startsWith("@");
const underSupports = (stack) => stack.some((prelude) => prelude.startsWith("@supports"));

export function addLegacyColorFallbacks(css) {
  // rule key -> { wrappers, selector, condition, declarations: [] }
  const guarded = new Map();

  // Tailwind's own `@supports (color: color-mix(in lab, …))` blocks are its
  // fallback mechanism, and for a literal colour it also emits an unguarded
  // base declaration — those need nothing from us. But an opacity modifier on a
  // TOKEN (`bg-[var(--card)]/45`) has no static base it could emit, so the
  // guarded declaration is the only one there is and the utility paints nothing
  // on an old engine. Auditing first means we add a twin for exactly those,
  // instead of duplicating all ~1,300 guarded rules for the sake of 64.
  const gaps = new Set(
    auditLegacyColorCoverage(css).unrescued.map(({ rule, property }) => `${rule}||${property}`)
  );
  const ruleKey = (stack) => stack.filter((prelude) => !prelude.startsWith("@supports")).join("|");

  const collect = (stack, declaration, features) => {
    // Any enclosing @supports has to be dropped: our `not (…)` block is the
    // complement of Tailwind's positive guard, so nesting inside it would mean
    // the fallback can never match.
    const wrappers = stack.slice(0, -1).filter((prelude) => !prelude.startsWith("@supports"));
    const selector = stack[stack.length - 1];
    const condition = supportsCondition(features);
    const key = `${wrappers.join(" ")}${selector}${condition}`;
    if (!guarded.has(key)) guarded.set(key, { wrappers, selector, condition, declarations: [] });
    guarded.get(key).declarations.push(declaration);
  };

  const out = walkStylesheet(css, ({ text, stack, terminator }) => {
    if (!inStyleRule(stack) || !text.trim()) return undefined;
    const declaration = splitDeclaration(text);
    if (!declaration) return undefined;
    const features = featuresIn(declaration.value);
    if (!usesAnyFeature(features)) return undefined;
    const fallback = fallbackValue(declaration.value, features, declaration.property);
    if (fallback === declaration.value) return undefined;

    const suffix = declaration.important ? "!important" : "";
    if (underSupports(stack)) {
      if (!gaps.has(`${ruleKey(stack)}||${declaration.property}`)) return undefined;
      collect(stack, `${declaration.property}:${fallback}${suffix}`, features);
      return undefined;
    }
    if (declaration.property.startsWith("--")) {
      // A custom property keeps its unparsed value even where the function is
      // unknown, so the later declaration would win. Only @supports can undo it.
      collect(stack, `${declaration.property}:${fallback}${suffix}`, features);
      return undefined;
    }
    // A real property drops the unsupported declaration at parse time, so the
    // plain one in front of it is what the old engine ends up using. `!important`
    // has to be carried across or the fallback loses to unrelated rules.
    return `${declaration.property}:${fallback}${suffix};${text}${terminator}`;
  });

  if (guarded.size === 0) return out;

  let appended = "";
  for (const { wrappers, selector, condition, declarations } of guarded.values()) {
    // @supports sits innermost so the media/layer context it was written in is
    // reproduced exactly; appending at the end of that layer is what wins.
    const open = wrappers.map((prelude) => `${prelude}{`).join("");
    const close = "}".repeat(wrappers.length);
    appended += `${open}@supports ${condition}{${selector}{${declarations.join(";")}}}${close}`;
  }
  return out + appended;
}

/**
 * Simulates an engine that drops every declaration using a modern colour
 * function, and reports the properties then left with no value at all — i.e.
 * what would actually paint nothing. `@supports`-guarded declarations count as
 * surviving and are credited to the rule they override, which is why their
 * preludes are stripped from the grouping key.
 */
export function auditLegacyColorCoverage(css) {
  const rules = new Map();

  walkStylesheet(css, ({ text, stack }) => {
    if (!inStyleRule(stack) || !text.trim()) return undefined;
    const declaration = splitDeclaration(text);
    if (!declaration) return undefined;
    const modern = usesAnyFeature(featuresIn(declaration.value));
    const key = stack.filter((prelude) => !prelude.startsWith("@supports")).join("|");
    if (!rules.has(key)) rules.set(key, new Map());
    const properties = rules.get(key);
    const entry = properties.get(declaration.property) || { modern: false, survives: false };
    entry.modern = entry.modern || modern;
    entry.survives = entry.survives || !modern;
    properties.set(declaration.property, entry);
    return undefined;
  });

  const unrescued = [];
  let total = 0;
  for (const [rule, properties] of rules) {
    for (const [property, entry] of properties) {
      if (!entry.modern) continue;
      total += 1;
      if (!entry.survives) unrescued.push({ property, rule });
    }
  }
  return { total, unrescued };
}

export default addLegacyColorFallbacks;
