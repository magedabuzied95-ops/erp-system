/* The product description is stored as plain text (description_ar /
 * description_en) so every other reader — the AI inbox, feeds, the editor
 * textarea, search snippets — still gets readable prose. The layout lives in a
 * few line conventions the product page turns into sections:
 *
 *   headline line
 *   intro paragraph
 *   المميزات:            <- a heading is a short line ending with ":"
 *   • Title: detail      <- feature bullet
 *   ليه تختاره:
 *   paragraph
 *   مناسب لـ:
 *   ✓ item               <- check item
 *
 * Older descriptions (one or more plain paragraphs) parse as paragraphs only. */

export const DESCRIPTION_HEADINGS = {
  ar: { features: "المميزات", why: "ليه تختاره", whyWomen: "ليه تختاريه", idealFor: "مناسب لـ" },
  en: { features: "Key Features", why: "Why You'll Love It", whyWomen: "Why You'll Love It", idealFor: "Ideal For" },
};

const clean = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();

export const composeProductDescription = (sections = {}, language = "ar", { audience = "" } = {}) => {
  const headings = DESCRIPTION_HEADINGS[language === "en" ? "en" : "ar"];
  const features = (Array.isArray(sections.features) ? sections.features : [])
    .map((item) => ({ title: clean(item?.title).replace(/[:：]+$/, ""), detail: clean(item?.detail) }))
    .filter((item) => item.title && item.detail);
  const idealFor = (Array.isArray(sections.ideal_for) ? sections.ideal_for : []).map(clean).filter(Boolean);
  const blocks = [
    clean(sections.headline),
    clean(sections.intro),
    features.length ? [`${headings.features}:`, ...features.map((item) => `• ${item.title}: ${item.detail}`)].join("\n") : "",
    clean(sections.why) ? `${audience === "women" ? headings.whyWomen : headings.why}:\n${clean(sections.why)}` : "",
    idealFor.length ? [`${headings.idealFor}:`, ...idealFor.map((item) => `✓ ${item}`)].join("\n") : "",
  ];
  return blocks.filter(Boolean).join("\n\n");
};

const HEADING_LINE = /^[^•✓\-*.!؟?]{2,40}[:：]$/;
const BULLET_LINE = /^[•\-*]\s+/;
const CHECK_LINE = /^[✓✔☑]\s*/;

/* Blocks for rendering: { type: "headline" | "paragraph" | "heading" | "features" | "checks", ... } */
export const parseProductDescription = (text = "") => {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
  const structured = lines.some((line) => HEADING_LINE.test(line)) && lines.some((line) => BULLET_LINE.test(line) || CHECK_LINE.test(line));
  const blocks = [];
  lines.forEach((line, index) => {
    if (!structured) {
      blocks.push({ type: "paragraph", text: line });
      return;
    }
    if (HEADING_LINE.test(line)) {
      blocks.push({ type: "heading", text: line.replace(/[:：]$/, "") });
      return;
    }
    if (BULLET_LINE.test(line)) {
      const body = line.replace(BULLET_LINE, "");
      const split = body.search(/[:：]\s/);
      const item = split > 0 && split <= 48 ? { title: body.slice(0, split), detail: body.slice(split + 1).trim() } : { title: "", detail: body };
      const last = blocks[blocks.length - 1];
      if (last?.type === "features") last.items.push(item);
      else blocks.push({ type: "features", items: [item] });
      return;
    }
    if (CHECK_LINE.test(line)) {
      const item = line.replace(CHECK_LINE, "");
      const last = blocks[blocks.length - 1];
      if (last?.type === "checks") last.items.push(item);
      else blocks.push({ type: "checks", items: [item] });
      return;
    }
    blocks.push({ type: index === 0 ? "headline" : "paragraph", text: line });
  });
  return blocks;
};

/* One line of prose for places that cannot show sections (meta tags, cards). */
export const flattenProductDescription = (text = "") =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((line) => clean(line).replace(BULLET_LINE, "").replace(CHECK_LINE, ""))
    .filter(Boolean)
    .map((line) => (/[.!؟?:：]$/.test(line) ? line : `${line}.`))
    .join(" ");
