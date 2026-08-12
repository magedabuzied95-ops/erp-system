/* Product form — shared visual vocabulary for the Add and Edit routes.
 *
 * Add (CreateProduct.jsx) and Edit (ProductEdit.jsx) are two separate ~4,500-line
 * pages that render the same product. Before this module they had drifted into
 * two visual languages: Add had been moved onto the semantic tokens, Edit was
 * still authored in fixed-dark chrome and ignored the active theme entirely.
 *
 * Presentation only. Nothing here touches the submit contract, the payloads, or
 * any product behaviour — these are class strings, and both pages keep their own
 * markup, handlers and form ownership.
 *
 * Contract (frozen M1):
 *   cards / sections / nested panels -> var(--radius-card)    14px
 *   buttons / inputs / controls      -> var(--radius-control) 10px
 *   gold is restricted to primary, active and focus
 */

/* Section icon tile. Deliberately one restrained treatment rather than a hue per
   section: the previous per-section rainbow was decorative wayfinding, not
   meaning, and carried the last legacy-palette colours in these files. */
export const SECTION_ICON_CLASSES = "border-border bg-surface-soft text-text-muted";

/* Top-level form section. --card surface so sections read above the page canvas,
   with nested groups on --surface-soft inside them. */
export const SECTION_CARD_CLASSES =
  "rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-[var(--shadow-card)]";

/* A grouped panel *inside* a section. Same corner as the card per the frozen
   contract; the surface is what separates it, not the radius. */
export const SECTION_PANEL_CLASSES = "rounded-[var(--radius-card)] border border-border bg-surface-soft";

export const buttonClasses = (variant = "secondary", extra = "") => {
  const base =
    "inline-flex items-center justify-center gap-2 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary:
      "border border-primary bg-primary text-[var(--primary-contrast)] hover:bg-[var(--primary-hover)] hover:border-[var(--primary-hover)]",
    secondary: "border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-hover",
    ghost: "text-text hover:bg-surface-hover hover:text-text",
    danger: "border border-danger/25 bg-danger-subtle text-danger hover:border-danger/40 hover:bg-danger/15",
  };
  return `${base} ${variants[variant] || variants.secondary} ${extra}`;
};
