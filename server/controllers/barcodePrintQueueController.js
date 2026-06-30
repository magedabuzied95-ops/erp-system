import { getTenantId, tenantContextMissingResponse } from "../utils/requestScope.js";
import { buildThermalColorJobGroups, scheduleThermalColorArtworkJobs } from "../services/thermalColorJobPlanner.js";
import {
  deleteBarcodePrintQueueItem,
  findBarcodePrintQueueItemByProductColorKey,
  listBarcodePrintQueueItems,
  markBarcodePrintQueuePrinted,
  requeueBarcodePrintQueueItem,
} from "../services/barcodePrintQueueService.js";

const readBoolean = (value) => value === true || String(value || "").toLowerCase() === "true";
const normalizeText = (value = "") => String(value ?? "").trim();
const normalizeColorKey = (value = "") => normalizeText(value).toLowerCase();

export const getBarcodePrintQueue = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const rows = await listBarcodePrintQueueItems({
      tenantId,
      includePrinted: readBoolean(req.query?.includePrinted),
      productId: req.query?.productId ?? req.query?.product_id ?? null,
      status: req.query?.status ?? "",
    });

    return res.json({
      success: true,
      data: rows,
      queue: rows,
    });
  } catch (error) {
    console.error("[barcode-print-queue] list failed", {
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to load barcode print queue",
    });
  }
};

export const markBarcodePrintQueuePrintedController = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const row = await markBarcodePrintQueuePrinted({
      id: req.params.id,
      tenantId,
      printedBy: req.user?.id || null,
    });

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Queue item not found",
      });
    }

    return res.json({
      success: true,
      data: row,
      queue: row,
    });
  } catch (error) {
    console.error("[barcode-print-queue] mark printed failed", {
      id: req.params.id,
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to mark queue item as printed",
    });
  }
};

export const requeueBarcodePrintQueueController = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const row = await requeueBarcodePrintQueueItem({
      id: req.params.id,
      tenantId,
    });

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Queue item not found",
      });
    }

    return res.json({
      success: true,
      data: row,
      queue: row,
    });
  } catch (error) {
    console.error("[barcode-print-queue] regenerate failed", {
      id: req.params.id,
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to regenerate barcode print item",
    });
  }
};

export const deleteBarcodePrintQueueController = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const row = await deleteBarcodePrintQueueItem({
      id: req.params.id,
      tenantId,
    });

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Queue item not found",
      });
    }

    return res.json({
      success: true,
      deleted: true,
      data: row,
    });
  } catch (error) {
    console.error("[barcode-print-queue] delete failed", {
      id: req.params.id,
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to delete barcode print item",
    });
  }
};

export const bulkAddBarcodePrintQueueController = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const regenerateExisting = readBoolean(req.body?.regenerateExisting ?? req.body?.regenerate_existing);
    const colorMode = String(req.body?.colorMode ?? req.body?.color_mode ?? "all").toLowerCase() === "selected" ? "selected" : "all";
    const products = Array.isArray(req.body?.products) ? req.body.products : [];
    if (!products.length) {
      return res.status(400).json({
        success: false,
        message: "No products provided",
      });
    }

    const scheduledByProduct = new Map();
    let addedCount = 0;
    let regeneratedCount = 0;
    let skippedCount = 0;

    for (const product of products) {
      const productId = Number(product?.productId ?? product?.id ?? 0) || null;
      if (!productId) continue;

      const productName = normalizeText(product?.productName ?? product?.name ?? "");
      const productImageUrl = normalizeText(product?.productImageUrl ?? product?.product_image_url ?? product?.image_url ?? "");
      const variants = Array.isArray(product?.variants) ? product.variants : [];
      const colorImages = Array.isArray(product?.colorImages)
        ? product.colorImages
        : Array.isArray(product?.color_images)
          ? product.color_images
          : [];

      let groups = buildThermalColorJobGroups({
        productId,
        productName,
        variants,
        colorImages,
        productImageUrl,
      });

      if (colorMode === "selected") {
        const selectedColorKeys = new Set(
          (Array.isArray(product?.selectedColorKeys) ? product.selectedColorKeys : [])
            .map(normalizeColorKey)
            .filter(Boolean)
        );
        if (selectedColorKeys.size) {
          groups = groups.filter((group) => {
            const groupColorKey = normalizeColorKey(group?.colorKey || group?.color);
            return selectedColorKeys.has(groupColorKey) || selectedColorKeys.has(normalizeColorKey(group?.color));
          });
        }
      }

      const groupsToSchedule = [];
      const previousThermalUrlMap = new Map();

      for (const group of groups) {
        const queueColorKey = normalizeText(group?.colorKey || group?.color || group?.primaryImageUrl).toLowerCase();
        const previousThermalMapKey = normalizeText(group?.primaryImageUrl).toLowerCase();
        if (!queueColorKey) continue;

        const existingRow = await findBarcodePrintQueueItemByProductColorKey({
          tenantId,
          productId,
          colorKey: queueColorKey,
        });

        if (existingRow && !regenerateExisting) {
          skippedCount += 1;
          continue;
        }

        if (existingRow && regenerateExisting) {
          const row = await requeueBarcodePrintQueueItem({
            id: existingRow.id,
            tenantId,
          });
          if (row) {
            regeneratedCount += 1;
          }
          continue;
        }

        groupsToSchedule.push({
          ...group,
          source: group?.source || "color-group",
        });
        previousThermalUrlMap.set(previousThermalMapKey, normalizeText(group?.existingThermalUrl));
        addedCount += 1;
      }

      if (groupsToSchedule.length) {
        scheduledByProduct.set(String(productId), {
          productId,
          productName,
          groups: groupsToSchedule,
          previousThermalUrlMap,
        });
      }
    }

    for (const { productId, productName, groups, previousThermalUrlMap } of scheduledByProduct.values()) {
      scheduleThermalColorArtworkJobs({
        productId,
        tenantId,
        productName,
        groups,
        previousThermalUrlMap,
      });
    }

    return res.json({
      success: true,
      data: {
        addedCount,
        regeneratedCount,
        skippedCount,
        totalCount: addedCount + regeneratedCount,
      },
    });
  } catch (error) {
    console.error("[barcode-print-queue] bulk add failed", {
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to add products to barcode print queue",
    });
  }
};
