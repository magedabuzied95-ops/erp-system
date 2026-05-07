import express from "express";
import pkg from "pg";

const { Pool } = pkg;

const router = express.Router();

/* DATABASE CONNECTION */

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "erp_db",
  password: "065342",
  port: 5432,
});

/* GET PRODUCTS */

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products ORDER BY id ASC"
    );

    res.json(result.rows);
  } catch (error) {
    console.log(error);
  }
});

/* ADD PRODUCT */

router.post("/", async (req, res) => {
  const { name, description } =
    req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO products
      (name, description)

      VALUES ($1, $2)

      RETURNING *
      `,
      [name, description]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
  }
});

/* DELETE PRODUCT */

router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    await pool.query(
      `
      DELETE FROM products
      WHERE id = $1
      `,
      [id]
    );

    res.json({
      message: "Product Deleted",
    });
  } catch (error) {
    console.log(error);
  }
});

export default router;