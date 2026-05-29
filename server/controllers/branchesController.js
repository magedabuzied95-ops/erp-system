import db from "../database/db.js";
import { randomBytes } from "node:crypto";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { ensureBranchSchema } from "../utils/branchSchema.js";
import { SINGLE_BRANCH_CODE, SINGLE_BRANCH_NAME, ensureSingleBranchModeOnce } from "../utils/singleBranchMode.js";

const normalizeBranch = (row = {}) => ({
  id: row.id,
  name: row.name || "",
  code: row.code || "",
  phone: row.phone || "",
  address: row.address || "",
  manager: row.manager || "",
  notes: row.notes || "",
  default_warehouse_id: row.default_warehouse_id || null,
  latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
  longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
  attendance_radius_meters: Number(row.attendance_radius_meters || row.allowed_radius_meters || 100),
  allowed_radius_meters: Number(row.allowed_radius_meters || row.attendance_radius_meters || 100),
  attendance_public_code: row.attendance_public_code || "",
  is_active: row.is_active !== false,
});

const parseOptionalCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const parseAttendanceRadius = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 100;
  return Math.round(number);
};

const normalizeBranchInput = (body = {}) => ({
  name: String(body.name || "").trim(),
  code: String(body.code || "").trim() || null,
  phone: String(body.phone || "").trim(),
  address: String(body.address || "").trim(),
  manager: String(body.manager || "").trim(),
  notes: String(body.notes || "").trim(),
  default_warehouse_id: body.default_warehouse_id || body.defaultWarehouseId || null,
  latitude: parseOptionalCoordinate(body.latitude),
  longitude: parseOptionalCoordinate(body.longitude),
  attendance_radius_meters: parseAttendanceRadius(body.attendance_radius_meters ?? body.attendanceRadiusMeters ?? body.allowed_radius_meters),
  is_active: body.is_active !== false,
});

const generateAttendancePublicCode = (branchId) => `b${branchId}-${randomBytes(3).toString("hex")}`;

const findDuplicateCode = async ({ tenantId, code, excludeId = null }) => {
  if (!code) return null;

  const result = await db.query(
    `
    SELECT id, name, code
    FROM branches
    WHERE tenant_id = $1
      AND LOWER(COALESCE(code, '')) = LOWER($2)
      AND ($3::bigint IS NULL OR id <> $3::bigint)
    LIMIT 1
    `,
    [tenantId, code, excludeId]
  );

  return result.rows[0] || null;
};

export const getBranches = async (req, res) => {
  const startedAt = Date.now();
  console.log("[branches] route start", { requestId: req.id, url: req.originalUrl, query: req.query });
  try {
    await ensureBranchSchema();
    await ensureSingleBranchModeOnce();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const status = String(req.query?.status || "").toLowerCase();

    const params = [];
    const clauses = [];

    if (tenantId !== null) {
      params.push(tenantId);
      clauses.push(`tenant_id = $${params.length}`);
    }

    if (status) {
      clauses.push(`is_active = ${["inactive", "false", "0"].includes(status) ? "FALSE" : "TRUE"}`);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await db.query(
      `
      SELECT
        id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        latitude,
        longitude,
        attendance_radius_meters,
        allowed_radius_meters,
        attendance_public_code,
        is_active
      FROM branches
      ${whereClause}
      ORDER BY name ASC, id DESC
      `,
      params
    );

    console.log("[branches] route end", {
      requestId: req.id,
      durationMs: Date.now() - startedAt,
      count: result.rows.length,
    });

    return res.status(200).json({
      success: true,
      data: result.rows.map(normalizeBranch),
      branches: result.rows.map(normalizeBranch),
    });
  } catch (error) {
    console.error("[branches] route thrown", {
      requestId: req.id,
      durationMs: Date.now() - startedAt,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: String(error.message || "").includes("timeout exceeded when trying to connect")
        ? "Database is busy. Please retry shortly."
        : error.message || "Failed to fetch branches",
      code: String(error.message || "").includes("timeout exceeded when trying to connect") ? "DB_POOL_TIMEOUT" : "BRANCHES_ERROR",
    });
  }
};

export const createBranch = async (req, res) => {
  try {
    await ensureBranchSchema();
    const singleBranch = await ensureSingleBranchModeOnce();
    const tenantId = getTenantId(req, req.user?.tenant_id) || 1;
    const branch = normalizeBranchInput(req.body);

    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant is required" });
    }

    const result = await db.query(
      `
      UPDATE branches
      SET
        tenant_id = $1,
        name = $2,
        code = COALESCE(NULLIF($3, ''), code, $4),
        phone = COALESCE($5, phone, ''),
        address = COALESCE($6, address, ''),
        manager = COALESCE($7, manager, ''),
        notes = COALESCE($8, notes, ''),
        default_warehouse_id = COALESCE($9, default_warehouse_id),
        latitude = COALESCE($10, latitude),
        longitude = COALESCE($11, longitude),
        attendance_radius_meters = COALESCE($12, attendance_radius_meters, 100),
        allowed_radius_meters = COALESCE($12, allowed_radius_meters, 100),
        is_active = TRUE,
        updated_at = NOW()
      WHERE id = $13
      RETURNING
        id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        latitude,
        longitude,
        attendance_radius_meters,
        allowed_radius_meters,
        attendance_public_code,
        is_active
      `,
      [
        tenantId,
        SINGLE_BRANCH_NAME,
        branch.code || SINGLE_BRANCH_CODE,
        SINGLE_BRANCH_CODE,
        branch.phone,
        branch.address,
        branch.manager,
        branch.notes,
        branch.default_warehouse_id,
        branch.latitude,
        branch.longitude,
        branch.attendance_radius_meters,
        singleBranch.branchId,
      ]
    );

    return res.status(200).json({
      success: true,
      data: normalizeBranch(result.rows[0]),
      branch: normalizeBranch(result.rows[0]),
    });
  } catch (error) {
    console.log("CREATE BRANCH ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create branch",
    });
  }
};

export const updateBranch = async (req, res) => {
  try {
    await ensureBranchSchema();
    await ensureSingleBranchModeOnce();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const branch = normalizeBranchInput(req.body);

    const existing = await db.query(
      `
      SELECT id, tenant_id
      FROM branches
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [req.params.id, tenantId]
    );

    if (!existing.rows[0]) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    const duplicate = await findDuplicateCode({
      tenantId: existing.rows[0].tenant_id,
      code: branch.code,
      excludeId: req.params.id,
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Branch code already exists",
      });
    }

    const result = await db.query(
      `
      UPDATE branches
      SET
        name = $1,
        code = COALESCE(NULLIF($2, ''), code, $14),
        phone = $3,
        address = $4,
        manager = $5,
        notes = $6,
        default_warehouse_id = $7,
        latitude = $8,
        longitude = $9,
        attendance_radius_meters = $10,
        allowed_radius_meters = $10,
        is_active = TRUE,
        updated_at = NOW()
      WHERE id = $12
        AND ($13::bigint IS NULL OR tenant_id = $13::bigint)
      RETURNING
        id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        latitude,
        longitude,
        attendance_radius_meters,
        allowed_radius_meters,
        attendance_public_code,
        is_active
      `,
      [
        SINGLE_BRANCH_NAME,
        branch.code,
        branch.phone,
        branch.address,
        branch.manager,
        branch.notes,
        branch.default_warehouse_id,
        branch.latitude,
        branch.longitude,
        branch.attendance_radius_meters,
        true,
        req.params.id,
        tenantId,
        SINGLE_BRANCH_CODE,
      ]
    );

    return res.status(200).json({
      success: true,
      data: normalizeBranch(result.rows[0]),
      branch: normalizeBranch(result.rows[0]),
    });
  } catch (error) {
    console.log("UPDATE BRANCH ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update branch",
    });
  }
};

export const deleteBranch = async (req, res) => {
  try {
    await ensureBranchSchema();
    const singleBranch = await ensureSingleBranchModeOnce();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    if (String(req.params.id) === String(singleBranch.branchId)) {
      const result = await db.query(
        `
        SELECT
          id,
          name,
          code,
          phone,
          address,
          manager,
          notes,
          default_warehouse_id,
          latitude,
          longitude,
          attendance_radius_meters,
          allowed_radius_meters,
          attendance_public_code,
          is_active
        FROM branches
        WHERE id = $1
        `,
        [singleBranch.branchId]
      );

      return res.status(200).json({
        success: true,
        data: normalizeBranch(result.rows[0]),
        branch: normalizeBranch(result.rows[0]),
        archived: false,
        message: "Single system branch cannot be deleted",
      });
    }

    const employeeCount = await db.query(
      `
      SELECT COUNT(*)::int AS linked_employees
      FROM employees
      WHERE branch_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      `,
      [req.params.id, tenantId]
    );
    const params = [req.params.id, tenantId];
    const result = await db.query(
      `
      UPDATE branches
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      RETURNING
        id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        latitude,
        longitude,
        attendance_radius_meters,
        allowed_radius_meters,
        attendance_public_code,
        is_active
      `,
      params
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    return res.status(200).json({
      success: true,
      data: normalizeBranch(result.rows[0]),
      branch: normalizeBranch(result.rows[0]),
      archived: true,
      linked_employees: Number(employeeCount.rows[0]?.linked_employees || 0),
    });
  } catch (error) {
    console.log("DELETE BRANCH ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete branch",
    });
  }
};

export const regenerateAttendanceQrToken = async (req, res) => {
  try {
    await ensureBranchSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const publicCode = generateAttendancePublicCode(req.params.id);

    const result = await db.query(
      `
      UPDATE branches
      SET attendance_public_code = $1, updated_at = NOW()
      WHERE id = $2
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
      RETURNING
        id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        latitude,
        longitude,
        attendance_radius_meters,
        allowed_radius_meters,
        attendance_public_code,
        is_active
      `,
      [publicCode, req.params.id, tenantId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    return res.status(200).json({
      success: true,
      data: normalizeBranch(result.rows[0]),
      branch: normalizeBranch(result.rows[0]),
      message: "Attendance short code regenerated",
    });
  } catch (error) {
    console.log("REGENERATE BRANCH ATTENDANCE QR ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to regenerate attendance QR token",
    });
  }
};

export default getBranches;
