import db from "../database/db.js";
import { getActiveBarcodePrintQueueItem, upsertBarcodePrintQueueItem } from "./barcodePrintQueueService.js";
import { regenerateThermalImageForProductImage } from "./thermalArtworkService.js";

const normalizeText = (value = "") => String(value || "").trim();
const normalizeColorKey = (value = "") => normalizeText(value).toLowerCase();
const firstText = (...values) => values.map((value) => normalizeText(value)).find(Boolean) || "";
const colorIdentifierFromSource = (source = {}) =>
  firstText(
    source?.color_key,
    source?.colorKey,
    source?.color,
    source?.color_name,
    source?.colorName,
    source?.color_value,
    source?.color_group_id,
    source?.colorGroupId,
    source?.color_id,
    source?.colorId,
    source?.group_id,
    source?.groupId,
    source?.id,
    source?.image_url,
    source?.primary_image_url
  );

const THERMAL_COLOR_JOB_IN_FLIGHT = new Map();

const colorImageFromGroup = (group = {}) =>
  firstText(
    group?.primary_image_url,
    group?.primaryImageUrl,
    group?.colorPrimaryImageUrl,
    group?.image_url,
    group?.color_image_url,
    group?.imageUrl
  );

const thermalImageFromGroup = (group = {}) =>
  firstText(
    group?.thermal_image_url,
    group?.color_thermal_image_url,
    group?.variant_color_thermal_image_url,
    group?.thermalImageUrl
  );

export const buildThermalColorJobGroups = ({
  productId = null,
  productName = "",
  variants = [],
  colorImages = [],
  productImageUrl = "",
  requireOptIn = false,
  generateProductCover = false,
} = {}) => {
  const groups = new Map();
  const optedInColorKeys = new Set();

  for (const colorGroup of Array.isArray(colorImages) ? colorImages : []) {
    const colorKey = normalizeColorKey(colorIdentifierFromSource(colorGroup));
    const primaryImageUrl = colorImageFromGroup(colorGroup);
    const thermalGenerationEnabled = colorGroup?.generate_thermal_artwork === true || colorGroup?.thermal_generation_enabled === true;
    if (thermalGenerationEnabled && colorKey) optedInColorKeys.add(colorKey);
    if (requireOptIn && !thermalGenerationEnabled) continue;
    if (!colorKey && !primaryImageUrl) continue;
    const groupKey = `${productId || "product"}|${colorKey || "default"}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        productId,
        productName: normalizeText(productName),
        colorKey,
        color: normalizeText(colorGroup?.color || colorGroup?.color_name || colorGroup?.color_value),
        primaryImageUrl,
        variantIds: [],
        representativeVariantId: null,
        existingThermalUrl: thermalImageFromGroup(colorGroup),
        source: "color-group",
        regenerate: Boolean(colorGroup?.regenerate || colorGroup?.explicitRegenerate),
      });
    } else if (!groups.get(groupKey).existingThermalUrl) {
      groups.get(groupKey).existingThermalUrl = thermalImageFromGroup(colorGroup);
    }
  }

  for (const variant of Array.isArray(variants) ? variants : []) {
    const colorKey = normalizeColorKey(colorIdentifierFromSource(variant));
    const thermalGenerationEnabled = variant?.generate_thermal_artwork === true || variant?.thermal_generation_enabled === true;
    if (requireOptIn && !thermalGenerationEnabled && !optedInColorKeys.has(colorKey)) continue;
    const primaryImageUrl = firstText(
      variant?.primary_image_url,
      variant?.colorPrimaryImageUrl,
      variant?.variant_image_url,
      variant?.color_image_url,
      variant?.image_url
    );
    const groupKey = `${productId || "product"}|${colorKey || "default"}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        productId,
        productName: normalizeText(productName),
        colorKey,
        color: normalizeText(variant?.color || variant?.color_name),
        primaryImageUrl,
        variantIds: [],
        representativeVariantId: null,
        existingThermalUrl: firstText(
          variant?.thermal_image_url,
          variant?.variant_color_thermal_image_url,
          variant?.color_thermal_image_url,
          variant?.product_thermal_image_url
        ),
        source: "variant",
        regenerate: Boolean(variant?.regenerate || variant?.explicitRegenerate),
      });
    }

    const group = groups.get(groupKey);
    const variantId = Number(variant?.id ?? variant?.variant_id ?? 0) || null;
    if (variantId) {
      group.variantIds.push(variantId);
      if (!group.representativeVariantId) group.representativeVariantId = variantId;
    }
    if (!group.primaryImageUrl) {
      group.primaryImageUrl = primaryImageUrl;
    }
    if (!group.existingThermalUrl) {
      group.existingThermalUrl = firstText(
        variant?.thermal_image_url,
        variant?.variant_color_thermal_image_url,
        variant?.color_thermal_image_url,
        variant?.product_thermal_image_url
      );
    }
  }

  const productImage = normalizeText(productImageUrl);
  if (generateProductCover && productImage) {
    groups.set(`${productId || "product"}|__cover__`, {
      productId,
      productName: normalizeText(productName),
      colorKey: "__cover__",
      color: "Cover",
      primaryImageUrl: productImage,
      variantIds: [],
      representativeVariantId: null,
      existingThermalUrl: "",
      source: "product-image",
      regenerate: true,
    });
  }
  if (!groups.size && productImage) {
    console.log("AI_THERMAL_BLOCK_PRODUCT_COVER", {
      productId,
      productName: normalizeText(productName),
      productImageUrl: productImage,
      reason: "no_color_groups_with_images",
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    variantIds: [...new Set(group.variantIds)].filter(Boolean),
    primaryImageUrl: normalizeText(group.primaryImageUrl),
    existingThermalUrl: normalizeText(group.existingThermalUrl),
    productName: normalizeText(group.productName),
    color: normalizeText(group.color),
  }));
};

export const buildThermalImageUrlMap = (groups = []) => {
  const map = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const imageUrl = normalizeText(group?.primaryImageUrl || group?.primary_image_url);
    const thermalUrl = normalizeText(group?.existingThermalUrl || group?.thermal_image_url || group?.color_thermal_image_url || group?.variant_color_thermal_image_url);
    if (!imageUrl || !thermalUrl) continue;
    map.set(imageUrl.toLowerCase(), thermalUrl);
  }
  return map;
};

export const syncThermalImageToVariantGroup = async ({
  productId = null,
  tenantId = null,
  variantIds = [],
  thermalImageUrl = "",
  thermalImageStatus = "ready",
  thermalImageGeneratedAt = null,
  thermalImageError = "",
} = {}) => {
  const ids = [...new Set((Array.isArray(variantIds) ? variantIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];
  const safeUrl = normalizeText(thermalImageUrl);
  if (!ids.length || !productId || !safeUrl) return 0;

  const generatedAt = normalizeText(thermalImageGeneratedAt) || new Date().toISOString();
  const hasTenantFilter = tenantId !== null && tenantId !== undefined && String(tenantId).trim() !== "";
  const result = await db.query(
    hasTenantFilter
      ? `
        UPDATE product_variants
        SET thermal_image_url = $1,
            thermal_image_status = $2,
            thermal_image_generated_at = $3,
            thermal_image_error = $4
        WHERE product_id = $5
          AND id = ANY($6::bigint[])
          AND ($7::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $7::bigint)
        `
      : `
        UPDATE product_variants
        SET thermal_image_url = $1,
            thermal_image_status = $2,
            thermal_image_generated_at = $3,
            thermal_image_error = $4
        WHERE product_id = $5
          AND id = ANY($6::bigint[])
        `,
    hasTenantFilter
      ? [safeUrl, normalizeText(thermalImageStatus) || "ready", generatedAt, normalizeText(thermalImageError), productId, ids, Number(tenantId) || null]
      : [safeUrl, normalizeText(thermalImageStatus) || "ready", generatedAt, normalizeText(thermalImageError), productId, ids]
  );
  return Number(result.rowCount || 0);
};

const syncThermalImageToVariantGroupWithClient = async (client, {
  productId = null,
  tenantId = null,
  variantIds = [],
  thermalImageUrl = "",
  thermalImageStatus = "ready",
  thermalImageGeneratedAt = null,
  thermalImageError = "",
} = {}) => {
  const ids = [...new Set((Array.isArray(variantIds) ? variantIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];
  const safeUrl = normalizeText(thermalImageUrl);
  if (!ids.length || !productId || !safeUrl) return 0;

  const generatedAt = normalizeText(thermalImageGeneratedAt) || new Date().toISOString();
  const hasTenantFilter = tenantId !== null && tenantId !== undefined && String(tenantId).trim() !== "";
  const result = await client.query(
    hasTenantFilter
      ? `
        UPDATE product_variants
        SET thermal_image_url = $1,
            thermal_image_status = $2,
            thermal_image_generated_at = $3,
            thermal_image_error = $4
        WHERE product_id = $5
          AND id = ANY($6::bigint[])
          AND ($7::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $7::bigint)
        `
      : `
        UPDATE product_variants
        SET thermal_image_url = $1,
            thermal_image_status = $2,
            thermal_image_generated_at = $3,
            thermal_image_error = $4
        WHERE product_id = $5
          AND id = ANY($6::bigint[])
        `,
    hasTenantFilter
      ? [safeUrl, normalizeText(thermalImageStatus) || "ready", generatedAt, normalizeText(thermalImageError), productId, ids, Number(tenantId) || null]
      : [safeUrl, normalizeText(thermalImageStatus) || "ready", generatedAt, normalizeText(thermalImageError), productId, ids]
  );
  return Number(result.rowCount || 0);
};

const scheduleColorJob = ({
  productId = null,
  tenantId = null,
  group = {},
  previousThermalUrlMap = new Map(),
  onSync = null,
} = {}) => {
  const colorKey = normalizeColorKey(group?.colorKey || group?.color);
  const primaryImageUrl = normalizeText(group?.primaryImageUrl);
  const queueColorKey = colorKey || primaryImageUrl.toLowerCase();
  const explicitRegenerate = Boolean(group?.regenerate || group?.explicitRegenerate);
  const queueLabelCount = Math.max(1, Array.isArray(group?.variantIds) ? group.variantIds.length : 0);
  const queueVariantIds = Array.isArray(group?.variantIds) ? group.variantIds : [];
  const queueSource =
    group?.source === "product-image"
      ? "product_create"
      : group?.source === "variant" || group?.source === "color-group"
        ? "color_add"
        : "thermal_ready";
  const queuePayloadBase = {
    tenantId,
    productId,
    color: group?.color || "",
    colorKey: queueColorKey,
    imageUrl: primaryImageUrl,
    source: queueSource,
    labelCount: queueLabelCount,
    variantIds: queueVariantIds,
  };
  if (!primaryImageUrl) {
    console.log("AI_THERMAL_BLOCK_PRODUCT_COVER", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: "",
      reason: "missing_primary_image",
    });
    return null;
  }

  const existingThermalUrl = previousThermalUrlMap.get(primaryImageUrl.toLowerCase()) || "";
  const jobKey = `${productId || "product"}|${queueColorKey || "default"}`;
  if (!explicitRegenerate && existingThermalUrl) {
    void upsertBarcodePrintQueueItem({
      ...queuePayloadBase,
      thermalImageUrl: existingThermalUrl,
      status: "ready",
    }).catch((error) => {
      console.warn("[barcode-print-queue] ready sync failed", {
        productId,
        color: group?.color || "",
        message: error?.message || String(error),
      });
    });
    console.log("AI_THERMAL_SKIP_EXISTING_COLOR", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: primaryImageUrl,
      thermalImageUrl: existingThermalUrl,
      currentThermalImageUrl: normalizeText(group?.existingThermalUrl),
      variantIds: Array.isArray(group?.variantIds) ? group.variantIds : [],
    });
    return setImmediate(() => {
      void Promise.resolve(onSync ? onSync({
        thermalImageUrl: existingThermalUrl,
        thermalImageStatus: "ready",
        thermalImageGeneratedAt: new Date().toISOString(),
        group,
      }) : null).catch((error) => {
        console.warn("[thermal-color-job] sync existing thermal failed", {
          productId,
          color: group?.color || "",
          message: error?.message || String(error),
        });
      });
    });
  }

  const activeJobPromise = getActiveBarcodePrintQueueItem({
    tenantId,
    productId,
    colorKey: queueColorKey,
  }).catch(() => null);

  if (THERMAL_COLOR_JOB_IN_FLIGHT.has(jobKey)) {
    void upsertBarcodePrintQueueItem({
      ...queuePayloadBase,
      thermalImageUrl: normalizeText(group?.existingThermalUrl),
      status: "pending",
    }).catch((error) => {
      console.warn("[barcode-print-queue] pending sync failed", {
        productId,
        color: group?.color || "",
        message: error?.message || String(error),
      });
    });
    console.log("AI_THERMAL_SKIP_ACTIVE_JOB", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: primaryImageUrl,
      variantIds: Array.isArray(group?.variantIds) ? group.variantIds : [],
    });
    return THERMAL_COLOR_JOB_IN_FLIGHT.get(jobKey);
  }

  const job = (async () => {
    const activeJob = await activeJobPromise;
    if (activeJob) {
      console.log("AI_THERMAL_SKIP_ACTIVE_JOB", {
        productId,
        color: group?.color || "",
        colorKey,
        sourceImageUrl: primaryImageUrl,
        variantIds: Array.isArray(group?.variantIds) ? group.variantIds : [],
        status: activeJob.status,
      });
      return {
        success: false,
        skipped: true,
        reason: "active_job",
      };
    }

    console.log("AI_THERMAL_CREATE_COLOR_JOB", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: primaryImageUrl,
      variantIds: Array.isArray(group?.variantIds) ? group.variantIds : [],
      representativeVariantId: group?.representativeVariantId || null,
      regenerate: explicitRegenerate,
    });
    await upsertBarcodePrintQueueItem({
      ...queuePayloadBase,
      thermalImageUrl: normalizeText(group?.existingThermalUrl),
      status: "pending",
    }).catch((error) => {
      console.warn("[barcode-print-queue] queue sync failed", {
        productId,
        color: group?.color || "",
        message: error?.message || String(error),
      });
    });

    const result = await regenerateThermalImageForProductImage({
      entityType: group?.representativeVariantId ? "variant" : "product",
      productId,
      variantId: group?.representativeVariantId || null,
      tenantId,
      sourceImageUrl: primaryImageUrl,
      existingThermalImageUrl: existingThermalUrl,
      productName: normalizeText(group?.productName || ""),
      regenerate: true,
    });

    if (!result?.success || !result?.thermal_image_url) {
      await upsertBarcodePrintQueueItem({
        ...queuePayloadBase,
        thermalImageUrl: "",
        status: "failed",
      }).catch((error) => {
        console.warn("[barcode-print-queue] failed sync failed", {
          productId,
          color: group?.color || "",
          message: error?.message || String(error),
        });
      });
      throw Object.assign(new Error(result?.error || "Thermal generation failed"), { result });
    }

    await upsertBarcodePrintQueueItem({
      ...queuePayloadBase,
      thermalImageUrl: result.thermal_image_url,
      status: "ready",
    }).catch((error) => {
      console.warn("[barcode-print-queue] ready sync failed", {
        productId,
        color: group?.color || "",
        message: error?.message || String(error),
      });
    });

    if (typeof onSync === "function") {
      await onSync({
        thermalImageUrl: result.thermal_image_url,
        thermalImageStatus: "ready",
        thermalImageGeneratedAt: new Date().toISOString(),
        group,
      });
    }

    console.log("THERMAL_COLOR_JOB_COMPLETED", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: primaryImageUrl,
      thermalImageUrl: result.thermal_image_url,
      variantIds: Array.isArray(group?.variantIds) ? group.variantIds : [],
    });

    return result;
  })().catch((error) => {
    console.error("THERMAL_COLOR_JOB_FAILED", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: primaryImageUrl,
      message: error?.message || String(error),
      stack: error?.stack,
    });
    void upsertBarcodePrintQueueItem({
      ...queuePayloadBase,
      thermalImageUrl: "",
      status: "failed",
    }).catch((queueError) => {
      console.warn("[barcode-print-queue] failed sync failed", {
        productId,
        color: group?.color || "",
        message: queueError?.message || String(queueError),
      });
    });
    return {
      success: false,
      error: error?.message || String(error),
    };
  }).finally(() => {
    THERMAL_COLOR_JOB_IN_FLIGHT.delete(jobKey);
  });

  THERMAL_COLOR_JOB_IN_FLIGHT.set(jobKey, job);
  return job;
};

export const scheduleThermalColorArtworkJobs = ({
  productId = null,
  tenantId = null,
  productName = "",
  groups = [],
  previousThermalUrlMap = new Map(),
  onSync = null,
} = {}) => {
  console.log("THERMAL_COLOR_PLANNER_START", {
    productId,
    groupsCount: Array.isArray(groups) ? groups.length : 0,
  });
  for (const group of Array.isArray(groups) ? groups : []) {
    setImmediate(() => {
      void scheduleColorJob({
        productId,
        tenantId,
        group: {
          ...group,
          productName,
        },
        previousThermalUrlMap,
        onSync: typeof onSync === "function"
          ? onSync
          : async ({ thermalImageUrl, thermalImageStatus, thermalImageGeneratedAt, group: syncGroup }) => {
              if (!syncGroup?.variantIds?.length || !thermalImageUrl) return 0;
              return syncThermalImageToVariantGroup({
                productId,
                tenantId,
                variantIds: syncGroup.variantIds,
                thermalImageUrl,
                thermalImageStatus,
                thermalImageGeneratedAt,
                thermalImageError: "",
              });
            },
      });
    });
  }
};

export const collectThermalColorJobs = ({
  productId = null,
  productName = "",
  variants = [],
  colorImages = [],
  productImageUrl = "",
} = {}) => buildThermalColorJobGroups({
  productId,
  productName,
  variants,
  colorImages,
  productImageUrl,
});
