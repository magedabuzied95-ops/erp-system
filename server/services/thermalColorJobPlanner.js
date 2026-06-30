import db from "../database/db.js";
import { upsertBarcodePrintQueueItem } from "./barcodePrintQueueService.js";
import { regenerateThermalImageForProductImage } from "./thermalArtworkService.js";

const normalizeText = (value = "") => String(value || "").trim();
const normalizeColorKey = (value = "") => normalizeText(value).toLowerCase();
const firstText = (...values) => values.map((value) => normalizeText(value)).find(Boolean) || "";

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
} = {}) => {
  const groups = new Map();

  for (const colorGroup of Array.isArray(colorImages) ? colorImages : []) {
    const colorKey = normalizeColorKey(colorGroup?.color || colorGroup?.color_name || colorGroup?.color_value);
    const primaryImageUrl = colorImageFromGroup(colorGroup);
    if (!colorKey && !primaryImageUrl) continue;
    const groupKey = `${productId || "product"}|${colorKey || "default"}|${primaryImageUrl || "no-image"}`;
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
      });
    } else if (!groups.get(groupKey).existingThermalUrl) {
      groups.get(groupKey).existingThermalUrl = thermalImageFromGroup(colorGroup);
    }
  }

  for (const variant of Array.isArray(variants) ? variants : []) {
    const colorKey = normalizeColorKey(variant?.color || variant?.color_name);
    const primaryImageUrl = firstText(
      variant?.primary_image_url,
      variant?.colorPrimaryImageUrl,
      variant?.variant_image_url,
      variant?.color_image_url,
      variant?.image_url
    );
    const groupKey = `${productId || "product"}|${colorKey || "default"}|${primaryImageUrl || "no-image"}`;
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
  if (!groups.size && productImage) {
    groups.set(`${productId || "product"}|product|${productImage}`, {
      productId,
      productName: normalizeText(productName),
      colorKey: "product",
      color: "",
      primaryImageUrl: productImage,
      variantIds: [],
      representativeVariantId: null,
      existingThermalUrl: "",
      source: "product-image",
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
  const queueColorKey = primaryImageUrl.toLowerCase();
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
    console.log("THERMAL_COLOR_JOB_SKIPPED_EXISTING", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: "",
      reason: "missing_primary_image",
    });
    return null;
  }

  const existingThermalUrl = previousThermalUrlMap.get(primaryImageUrl.toLowerCase()) || "";
  const jobKey = `${productId || "product"}|${colorKey || "default"}|${primaryImageUrl.toLowerCase()}`;
  if (existingThermalUrl) {
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
    console.log("THERMAL_COLOR_JOB_SKIPPED_EXISTING", {
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
    console.log("THERMAL_COLOR_JOB_SKIPPED_IN_FLIGHT", {
      productId,
      color: group?.color || "",
      colorKey,
      sourceImageUrl: primaryImageUrl,
      variantIds: Array.isArray(group?.variantIds) ? group.variantIds : [],
    });
    return THERMAL_COLOR_JOB_IN_FLIGHT.get(jobKey);
  }

  console.log("THERMAL_COLOR_JOB_QUEUED", {
    productId,
    color: group?.color || "",
    colorKey,
    sourceImageUrl: primaryImageUrl,
    variantIds: Array.isArray(group?.variantIds) ? group.variantIds : [],
    representativeVariantId: group?.representativeVariantId || null,
  });
  void upsertBarcodePrintQueueItem({
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

  const job = (async () => {
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
