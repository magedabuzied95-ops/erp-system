import express from "express";
import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const router = express.Router();

router.get("/", protect, permit("expenses", "view"), async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const where = ["title ILIKE $1"];
    const params = [`%${search}%`];
    if (tenantId !== null) {
      where.push(`tenant_id = $${params.length + 1}`);
      params.push(tenantId);
    }

    const expenses = await db.query(
      `
      SELECT *
      FROM expenses
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    );

    const total = await db.query(
      `
      SELECT COUNT(*)
      FROM expenses
      WHERE ${where.join(" AND ")}
      `,
      params
    );

    res.status(200).json({
      success: true,
      expenses: expenses.rows,
      pagination: {
        total: Number(total.rows[0].count),
        page,
        limit,
        totalPages: Math.ceil(Number(total.rows[0].count) / limit),
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed To Fetch Expenses",
      error: error.message,
    });
  }
});

router.post("/", protect, permit("expenses", "create"), async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const { title, amount, category, note, payment_method, status } = req.body;

    if (!title?.trim() || !amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Title And Amount Required" });
    }

    const expense = await client.query(
      `
      INSERT INTO expenses (tenant_id, title, amount, category, payment_method, note, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [tenantId, title.trim(), amount, category || "", payment_method || "cash", note || "", status || "pending"]
    );

    await client.query(
      `
      INSERT INTO transactions (tenant_id, type, amount, payment_method, note, cashbox_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [tenantId, "expense", amount, payment_method || "cash", title, 1]
    );

    await client.query(
      `
      UPDATE cashbox
      SET balance = balance - $1
      WHERE id = 1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      `,
      [amount, tenantId]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Expense Added Successfully",
      expense: expense.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed To Create Expense",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

export default router;
