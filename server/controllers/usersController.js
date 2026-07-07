import bcrypt from "bcryptjs";

import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const normalizeRoleValue = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

const isAdminActor = (user = {}) => {
  const normalized = normalizeRoleValue(user?.role || user?.role_name || "");
  return normalized === "admin" || normalized === "super admin" || normalized === "superadmin" || isSuperAdminUser(user);
};

const parseBooleanValue = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on", "active", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "inactive", "disabled"].includes(normalized)) return false;
  return null;
};

const logUsersValidationFailure = (action, req, message, meta = {}) => {
  console.warn("[users] validation failure", {
    action,
    userId: req.user?.id ?? null,
    role: req.user?.role || req.user?.role_name || null,
    tenantId: req.user?.tenant_id ?? null,
    message,
    ...meta,
  });
};

/* ======================================================
   GET USERS
====================================================== */

export const getUsers =
async (req, res) => {

  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);

    const tenantFilter = isSuperAdminUser(req.user) || tenantId === null
      ? ""
      : "WHERE u.tenant_id = $1";

    const params = isSuperAdminUser(req.user) || tenantId === null ? [] : [tenantId];

    const users =
      await db.query(

        `
        SELECT

        u.id,
        u.name,
        u.email,
        u.role_id,
        u.is_active,

        r.name AS role

        FROM users u

        LEFT JOIN roles r

        ON u.role_id = r.id

        ${tenantFilter}

        ORDER BY u.id DESC
        `
        ,
        params
      );

    res.status(200).json({

      success: true,

      users:
        users.rows
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({

      success: false,

      message:
        "Failed To Fetch Users"
    });
  }
};

/* ======================================================
   CREATE USER
====================================================== */

export const createUser =
async (req, res) => {

  try {

    const {

      name,
      email,
      password,
      role_id

    } = req.body;
    const tenantId = getTenantId(req, req.user?.tenant_id);

    if (
      !name ||
      !email ||
      !password
    ) {
      logUsersValidationFailure("create", req, "missing_required_fields", {
        hasName: Boolean(String(name || "").trim()),
        hasEmail: Boolean(String(email || "").trim()),
        hasPassword: Boolean(String(password || "").trim()),
      });

      return res.status(400).json({

        success: false,

        message:
          "All Fields Required"
      });
    }

    const exists =
      await db.query(

        `
        SELECT id

        FROM users

        WHERE LOWER(email) = LOWER($1)
          AND tenant_id = $2
        `,

        [email, tenantId]
      );

    if (
      exists.rows.length > 0
    ) {
      logUsersValidationFailure("create", req, "email_already_exists", {
        email: String(email || "").trim(),
        tenantId,
      });

      return res.status(400).json({

        success: false,

        message:
          "Email Already Exists"
      });
    }

    const hashedPassword =
      await bcrypt.hash(
        password,
        10
      );

    const user =
      await db.query(

        `
        INSERT INTO users

        (
          tenant_id,
          name,
          email,
          password,
          role_id
        )

        VALUES
        ($1,$2,$3,$4,$5)

        RETURNING
        id,
        tenant_id,
        name,
        email
        `,

        [
          tenantId,
          name,
          email,
          hashedPassword,
        role_id
        ]
      );

    res.status(201).json({

      success: true,

      message:
        "User Created Successfully",

      user:
        user.rows[0]
    });

  } catch (error) {

    console.error("[users] create failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      message: error?.message || String(error),
    });

    res.status(500).json({

      success: false,

      message:
        "Failed To Create User"
    });
  }
};

/* ======================================================
   UPDATE USER ROLE
====================================================== */

export const updateUserRole =
async (req, res) => {

  try {

    const { id } =
      req.params;

    const { role_id } =
      req.body;
    const tenantId = getTenantId(req, req.user?.tenant_id);

    const whereClause = isSuperAdminUser(req.user) || tenantId === null
      ? "WHERE id = $2"
      : "WHERE id = $2 AND tenant_id = $3";
    const params = isSuperAdminUser(req.user) || tenantId === null
      ? [role_id, id]
      : [role_id, id, tenantId];

    const updated =
      await db.query(

        `
        UPDATE users

        SET role_id = $1

        ${whereClause}

        RETURNING *
        `,

        params
      );

    res.status(200).json({

      success: true,

      message:
        "Role Updated Successfully",

      user:
      updated.rows[0]
    });

  } catch (error) {

    console.error("[users] update role failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      targetUserId: req.params.id,
      message: error?.message || String(error),
    });

    res.status(500).json({

      success: false,

      message:
        "Failed To Update Role"
    });
  }
};

/* ======================================================
   UPDATE USER STATUS
====================================================== */

export const updateUserStatus =
async (req, res) => {

  try {

    const { id } = req.params;
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const isActive = req.body?.is_active ?? req.body?.isActive ?? req.body?.status;
    const nextStatus = parseBooleanValue(isActive);

    if (nextStatus === null) {
      logUsersValidationFailure("status", req, "missing_status", { targetUserId: id });
      return res.status(400).json({
        success: false,
        message: "is_active is required",
      });
    }

    const whereClause = isSuperAdminUser(req.user) || tenantId === null
      ? "WHERE id = $2"
      : "WHERE id = $2 AND tenant_id = $3";
    const params = isSuperAdminUser(req.user) || tenantId === null
      ? [nextStatus, id]
      : [nextStatus, id, tenantId];

    const updated = await db.query(
      `
      UPDATE users
      SET is_active = $1
      ${whereClause}
      RETURNING id, tenant_id, name, email, role_id, is_active
      `,
      params
    );

    res.status(200).json({
      success: true,
      message: "Status Updated Successfully",
      user: updated.rows[0] || null,
    });
  } catch (error) {
    console.error("[users] update status failed", {
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
      targetUserId: req.params.id,
      message: error?.message || String(error),
    });
    res.status(500).json({
      success: false,
      message: "Failed To Update Status",
    });
  }
};

/* ======================================================
   DELETE USER
====================================================== */

export const deleteUser =
async (req, res) => {

  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const params = isSuperAdminUser(req.user) || tenantId === null ? [req.params.id] : [req.params.id, tenantId];
    const whereClause = isSuperAdminUser(req.user) || tenantId === null ? "WHERE id = $1" : "WHERE id = $1 AND tenant_id = $2";

    await db.query(

      `
      DELETE FROM users

      ${whereClause}
      `,

      params
    );

    res.status(200).json({

      success: true,

      message:
        "User Deleted Successfully"
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({

      success: false,

      message:
        "Failed To Delete User"
    });
  }
};
