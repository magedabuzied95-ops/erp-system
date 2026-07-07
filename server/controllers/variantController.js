import pool from "../database/db.js";
import { getTenantId, tenantContextMissingResponse } from "../utils/requestScope.js";
import { syncProductPricingFromVariants } from "../services/productPricingSyncService.js";

export const addVariant = async (req, res) => {

  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const {
      product_id,
      color,
      size,
      stock,
      image_url,
    } = req.body;

    const newVariant = await pool.query(

      `
      INSERT INTO product_variants
      (
        tenant_id,
        product_id,
        color,
        size,
        stock,
        image_url
      )

      VALUES ($1, $2, $3, $4, $5, $6)

      RETURNING *
      `,

      [
        tenantId,
        product_id,
        color,
        size,
        stock,
        image_url,
      ]
    );
    await syncProductPricingFromVariants(pool, {
      productId: product_id,
      tenantId,
      variantId: newVariant.rows[0]?.id || null,
    });

    res.status(201).json(
      newVariant.rows[0]
    );

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: err.message,
    });
  }
};
