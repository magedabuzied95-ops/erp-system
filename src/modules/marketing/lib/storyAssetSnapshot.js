const text = (value) => String(value || "").trim();
export const CURRENT_STORY_RENDERER_BUILD = "m1-story-audience-collection-v1-2026-07-24";
export const CURRENT_STORY_TEMPLATE_KEY = "m1_story_current";
export const CURRENT_STORY_TEMPLATE_VERSION = "v1";

const objectValue = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const normalizeStoryAssetSnapshot = (input = {}) => {
  const item = objectValue(input.item?.id ? input.item : input);
  const metadata = objectValue(item.metadata);
  const design = objectValue(item.design_json);
  const source = objectValue(
    input.story_asset_snapshot ||
    input.final_story_asset ||
    input.asset ||
    item.final_asset_snapshot ||
    item.story_asset_snapshot ||
    metadata.story_asset_snapshot ||
    design.story_asset_snapshot
  );
  return {
    storyId: text(source.storyId || source.story_id),
    assetId: text(source.assetId || source.asset_id),
    assetUrl: text(source.assetUrl || source.asset_url),
    templateKey: text(source.templateKey || source.template_key),
    templateVersion: text(source.templateVersion || source.template_version),
    rendererBuild: text(source.rendererBuild || source.renderer_build),
    generationId: text(source.generationId || source.generation_id),
    checksum: text(source.checksum),
    generatedAt: text(source.generatedAt || source.generated_at),
  };
};

export const hasValidStoryAssetSnapshot = (input = {}) => {
  const snapshot = normalizeStoryAssetSnapshot(input);
  const item = input.item?.id ? input.item : input;
  return Boolean(
    snapshot.storyId &&
    snapshot.assetId &&
    snapshot.assetUrl &&
    snapshot.templateKey === CURRENT_STORY_TEMPLATE_KEY &&
    snapshot.templateVersion === CURRENT_STORY_TEMPLATE_VERSION &&
    snapshot.rendererBuild === CURRENT_STORY_RENDERER_BUILD &&
    snapshot.generationId &&
    snapshot.checksum &&
    (!item?.id || snapshot.storyId === String(item.id))
  );
};

export const mergeStoryAssetResponse = (currentItem = {}, response = {}) => {
  const responseItem = response?.item?.id ? response.item : response?.id ? response : currentItem;
  const snapshot = normalizeStoryAssetSnapshot({ ...response, item: responseItem });
  if (!hasValidStoryAssetSnapshot({ ...responseItem, metadata: {
    ...(responseItem.metadata || {}),
    ...(snapshot.assetId ? { story_asset_snapshot: snapshot } : {}),
  } })) return responseItem;
  return {
    ...currentItem,
    ...responseItem,
    assetId: snapshot.assetId,
    assetUrl: snapshot.assetUrl,
    assetChecksum: snapshot.checksum,
    final_asset_snapshot: snapshot,
    final_asset_url: snapshot.assetUrl,
    selectedPublishUrl: snapshot.assetUrl,
    rendered_image_url: snapshot.assetUrl,
    story_image_url: snapshot.assetUrl,
    metadata: {
      ...(currentItem.metadata || {}),
      ...(responseItem.metadata || {}),
      story_asset_snapshot: snapshot,
      story_asset_error: "",
    },
  };
};
