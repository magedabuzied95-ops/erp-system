import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  getRolePermissions,
  getRolesWithPermissions,
  replaceRolePermissions,
} from "../services/rolesService.js";

export const getRoles = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const roles = await getRolesWithPermissions({ db, tenantId });

    res.status(200).json({ success: true, roles });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Failed To Fetch Roles", error: error.message });
  }
};

export const getRolePermissionsByRole = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const role = await getRolePermissions({
      db,
      roleId: req.params.roleId,
      tenantId,
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: `Role '${req.params.roleId}' was not found`,
      });
    }

    res.status(200).json({ success: true, role, permissions: role.permissions || [] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Failed To Fetch Role Permissions", error: error.message });
  }
};

export const createRole = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const { name } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Role Name Required" });
    }

    const exists = await db.query(
      `
      SELECT id
      FROM roles
      WHERE LOWER(name) = LOWER($1)
        AND tenant_id = $2
      `,
      [name, tenantId]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Role Already Exists" });
    }

    const role = await db.query(
      `
      INSERT INTO roles (tenant_id, name)
      VALUES ($1, $2)
      RETURNING *
      `,
      [tenantId, name.trim()]
    );

    res.status(201).json({ success: true, message: "Role Created Successfully", role: role.rows[0] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Failed To Create Role", error: error.message });
  }
};

export const updateRolePermissions = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const roleId = req.params.roleId || req.params.id;
    const hasValidBody =
      Array.isArray(req.body?.permissions) ||
      Array.isArray(req.body?.selectedPermissions) ||
      Array.isArray(req.body?.selected) ||
      Array.isArray(req.body?.actions) ||
      (req.body?.modules && typeof req.body.modules === "object");

    if (!hasValidBody) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Permissions payload required. Send permissions, selectedPermissions, selected, actions, or modules.",
      });
    }

    const role = await replaceRolePermissions({
      client,
      roleId,
      tenantId,
      body: req.body,
    });

    if (!role) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: `Role '${roleId}' was not found`,
      });
    }

    await client.query("COMMIT");
    res.status(200).json({
      success: true,
      message: "Role Permissions Updated Successfully",
      role,
      permissions: role.permissions || [],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    res.status(500).json({ success: false, message: "Failed To Update Permissions", error: error.message });
  } finally {
    client.release();
  }
};

export const deleteRole = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;

    const users = await db.query(
      `
      SELECT id
      FROM users
      WHERE role_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      `,
      [id, tenantId]
    );

    if (users.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Cannot Delete Role In Use" });
    }

    const deleted = await db.query(
      `
      DELETE FROM roles
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      RETURNING *
      `,
      [id, tenantId]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Role Not Found" });
    }

    res.status(200).json({ success: true, message: "Role Deleted Successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Failed To Delete Role", error: error.message });
  }
};
