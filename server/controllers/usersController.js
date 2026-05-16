import bcrypt from "bcryptjs";

import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

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

    console.log(error);

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

    console.log(error);

    res.status(500).json({

      success: false,

      message:
        "Failed To Update Role"
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
