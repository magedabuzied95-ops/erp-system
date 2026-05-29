import pool from "../database/db.js";

export const getProductsWithVariants =
  async (req, res) => {

    try {
      await pool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
      await pool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`);

      const products = await pool.query(

        `
        SELECT
          products.id AS product_id,
          products.name,
          products.description,

          product_variants.id AS variant_id,
          product_variants.color,
          product_variants.size,
          product_variants.manufacturer_id,
          product_variants.stock,
          product_variants.barcode,
          product_variants.image_url

        FROM products

        LEFT JOIN product_variants

        ON products.id =
        product_variants.product_id
        AND product_variants.is_active IS DISTINCT FROM FALSE
        AND product_variants.deleted_at IS NULL

        ORDER BY products.id DESC
        `
      );

      res.json(products.rows);

    } catch (err) {

      console.log(err);

      res.status(500).json({
        error: err.message,
      });
    }
};

