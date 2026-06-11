import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSupplierStatement,
  listSuppliers,
  updateSupplier,
} from "../services/suppliersService.js";

const sendError = (res, error, fallbackMessage) => {
  const status = Number(error?.status || 500);
  if (status >= 500) {
    console.error("[suppliers] controller error", error);
  }
  return res.status(status).json({
    success: false,
    message: error?.message || fallbackMessage,
    error: error?.message || fallbackMessage,
    details: process.env.NODE_ENV === "production" ? undefined : error?.stack,
  });
};

const resolveTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));

export const listSuppliersController = async (req, res) => {
  try {
    const result = await listSuppliers({
      tenantId: resolveTenantId(req),
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      sort: req.query.sort,
    });
    return res.status(200).json({
      success: true,
      data: result.suppliers,
      suppliers: result.suppliers,
      pagination: result.pagination,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch suppliers");
  }
};

export const getSupplierController = async (req, res) => {
  try {
    const supplier = await getSupplierById({ tenantId: resolveTenantId(req), id: req.params.id });
    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }
    return res.status(200).json({ success: true, data: supplier, supplier });
  } catch (error) {
    return sendError(res, error, "Failed to fetch supplier");
  }
};

export const getSupplierStatementController = async (req, res) => {
  try {
    const statement = await getSupplierStatement({ tenantId: resolveTenantId(req), id: req.params.id });
    if (!statement) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }
    return res.status(200).json({ success: true, data: statement, statement });
  } catch (error) {
    return sendError(res, error, "Failed to build supplier statement");
  }
};

export const createSupplierController = async (req, res) => {
  try {
    const supplier = await createSupplier({ tenantId: getTenantId(req, req.user?.tenant_id), body: req.body });
    return res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
      supplier,
    });
  } catch (error) {
    return sendError(res, error, "Failed to create supplier");
  }
};

export const updateSupplierController = async (req, res) => {
  try {
    const supplier = await updateSupplier({ tenantId: resolveTenantId(req), id: req.params.id, body: req.body });
    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }
    return res.status(200).json({
      success: true,
      message: "Supplier updated successfully",
      data: supplier,
      supplier,
    });
  } catch (error) {
    return sendError(res, error, "Failed to update supplier");
  }
};

export const deleteSupplierController = async (req, res) => {
  try {
    const deleted = await deleteSupplier({ tenantId: resolveTenantId(req), id: req.params.id });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }
    return res.status(200).json({ success: true, message: "Supplier deleted successfully" });
  } catch (error) {
    return sendError(res, error, "Failed to delete supplier");
  }
};
