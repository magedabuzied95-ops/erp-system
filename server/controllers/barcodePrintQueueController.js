import { getTenantId, tenantContextMissingResponse } from "../utils/requestScope.js";
import {
  deleteBarcodePrintQueueItem,
  listBarcodePrintQueueItems,
  markBarcodePrintQueuePrinted,
  requeueBarcodePrintQueueItem,
} from "../services/barcodePrintQueueService.js";

const readBoolean = (value) => value === true || String(value || "").toLowerCase() === "true";

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
