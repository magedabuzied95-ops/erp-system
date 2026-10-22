// Catalog (Advantage+ catalog / dynamic product) ads. Pure, unit-tested.
//
// Such a creative carries no image of its own: object_story_spec.template_data names the
// product set's fields ("{{product.name}}") and Meta renders one card per product. The ad
// editor used to read it as a single-image creative with no media and "EXAMPLE.COM", so the
// owner could not open the shop's own best ad. Reading and writing the template live here.

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

export const CATALOG_CREATIVE_TYPE = "catalog";
export const DEFAULT_CATALOG_HEADLINE = "{{product.name}}";
export const DEFAULT_CATALOG_DESCRIPTION = "{{product.current_price}}";
export const DEFAULT_CATALOG_FORMAT = "carousel_images_multi_items";

// What a synced creative's template says, or null when it is not a catalog creative.
export const templateCreative = (creative = {}) => {
  const spec = creative?.object_story_spec || {};
  const template = spec.template_data;
  if (!template || typeof template !== "object") return null;
  return {
    creative_type: CATALOG_CREATIVE_TYPE,
    product_set_id: text(creative.product_set_id) || null,
    destination_url: text(template.link) || null,
    headline: text(template.name) || DEFAULT_CATALOG_HEADLINE,
    description: text(template.description) || null,
    primary_text: text(template.message) || null,
    call_to_action: text(template.call_to_action?.type) || null,
    format_option: text(template.format_option) || DEFAULT_CATALOG_FORMAT,
  };
};

// The Marketing API payload for a catalog creative row: template_data under the page story,
// product_set_id beside it. The ad set must promote the same product set.
export const catalogCreativeParams = (row = {}, { pageId, instagramUserId, callToAction } = {}) => {
  const link = text(row.destination_url);
  if (!link) throw new Error("A catalog ad needs the website link its products open on.");
  const story = { page_id: text(pageId) };
  if (instagramUserId) story.instagram_user_id = text(instagramUserId);
  story.template_data = {
    link,
    name: text(row.headline) || DEFAULT_CATALOG_HEADLINE,
    format_option: DEFAULT_CATALOG_FORMAT,
    multi_share_end_card: false,
  };
  if (text(row.description)) story.template_data.description = text(row.description);
  if (text(row.primary_text)) story.template_data.message = text(row.primary_text);
  if (callToAction?.type) story.template_data.call_to_action = { type: callToAction.type };
  const params = { object_story_spec: story };
  if (text(row.product_set_id)) params.product_set_id = text(row.product_set_id);
  return params;
};

// One flat list of product sets (one per catalog) the way the bootstrap hands it to the wizard.
export const catalogsFromProductSets = (productSets = []) => {
  const seen = new Map();
  for (const set of Array.isArray(productSets) ? productSets : []) {
    const id = text(set?.catalog_id);
    if (!id || seen.has(id)) continue;
    seen.set(id, { id, name: text(set.catalog_name) || id });
  }
  return [...seen.values()];
};
