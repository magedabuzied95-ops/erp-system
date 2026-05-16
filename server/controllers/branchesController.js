import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { ensureBranchSchema } from "../utils/branchSchema.js";

const normalizeBranch = (row = {}) => ({
  id: row.id,
  name: row.name || "",
  code: row.code || "",
  phone: row.phone || "",
  address: row.address || "",
  manager: row.manager || "",
  notes: row.notes || "",
  default_warehouse_id: row.default_warehouse_id || null,
  is_active: row.is_active !== false,
});

const normalizeBranchInput = (body = {}) => ({
  name: String(body.name || "").trim(),
  code: String(body.code || "").trim() || null,
  phone: String(body.phone || "").trim(),
  address: String(body.address || "").trim(),
  manager: String(body.manager || "").trim(),
  notes: String(body.notes || "").trim(),
  default_warehouse_id: body.default_warehouse_id || body.defaultWarehouseId || null,
  is_active: body.is_active !== false,
});

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
  try {
    await ensureBranchSchema();
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
        is_active
      FROM branches
      ${whereClause}
      ORDER BY name ASC, id DESC
      `,
      params
    );

    return res.status(200).json({
      success: true,
      data: result.rows.map(normalizeBranch),
      branches: result.rows.map(normalizeBranch),
    });
  } catch (error) {
    console.log("GET BRANCHES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch branches",
    });
  }
};

export const createBranch = async (req, res) => {
  try {
    await ensureBranchSchema();
    const tenantId = getTenantId(req, req.user?.tenant_id) || 1;
    const branch = normalizeBranchInput(req.body);

    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant is required" });
    }

    if (!branch.name) {
      return res.status(400).json({ success: false, message: "Branch name is required" });
    }

    const duplicate = await findDuplicateCode({ tenantId, code: branch.code });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Branch code already exists",
      });
    }

    const result = await db.query(
      `
      INSERT INTO branches (
        tenant_id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING
        id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        is_active
      `,
      [
        tenantId,
        branch.name,
        branch.code,
        branch.phone,
        branch.address,
        branch.manager,
        branch.notes,
        branch.default_warehouse_id,
        branch.is_active,
      ]
    );

    return res.status(201).json({
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
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const branch = normalizeBranchInput(req.body);

    if (!branch.name) {
      return res.status(400).json({ success: false, message: "Branch name is required" });
    }

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
        code = $2,
        phone = $3,
        address = $4,
        manager = $5,
        notes = $6,
        default_warehouse_id = $7,
        is_active = $8,
        updated_at = NOW()
      WHERE id = $9
        AND ($10::bigint IS NULL OR tenant_id = $10::bigint)
      RETURNING
        id,
        name,
        code,
        phone,
        address,
        manager,
        notes,
        default_warehouse_id,
        is_active
      `,
      [
        branch.name,
        branch.code,
        branch.phone,
        branch.address,
        branch.manager,
        branch.notes,
        branch.default_warehouse_id,
        branch.is_active,
        req.params.id,
        tenantId,
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
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
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

export default getBranches;
