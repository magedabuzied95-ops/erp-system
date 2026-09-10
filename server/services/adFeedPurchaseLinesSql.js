/*
  The purchase-invoice line a size is priced from, for the ad feeds — the SAME line the storefront
  picks in storefrontController's last_color_purchase_price, so an ad can never quote a different
  price than checkout. Each feed used to carry its own hand-written version and both drifted:
  one resurrected an older invoice's sale price that the newer invoice had dropped, and neither
  gave a size with no price of its own the colour fallback the shop uses, so the Meta feed
  advertised such a size at its strikethrough price.

  For a size V of product P in colour C, the winning line is:
    1. V's own newest line, if it has one;
    2. else, when neither V nor P carries any price of its own, the newest line of colour C;
    3. else the newest colour-level line of C (one that names no size).
  Then, as in the storefront payload:
    purchase selling price = COALESCE(line, pv.purchase_selling_price)
    sale price             = COALESCE(line, pv.sale_price)

  Splice AD_FEED_PURCHASE_CTES into a WITH list, AD_FEED_PURCHASE_JOINS after the
  product_variants join (aliases p and pv), and AD_FEED_PURCHASE_COLUMNS into the select.
*/

const QUALIFYING_PURCHASE = `COALESCE(NULLIF(LOWER(TRIM(pu.status)), ''), 'received') NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')
        AND (COALESCE(NULLIF(pi.selling_price, 0), NULLIF(pi.regular_price, 0)) > 0 OR NULLIF(pi.sale_price, 0) > 0)`;

export const AD_FEED_PURCHASE_CTES = `
    ad_purchase_lines AS (
      SELECT
        pi.id AS pi_id,
        pi.product_id,
        pi.variant_id,
        pu.created_at,
        COALESCE(LOWER(TRIM(pi.metadata->>'color')), '') AS match_color,
        COALESCE(NULLIF(pi.selling_price, 0), NULLIF(pi.regular_price, 0)) AS purchase_selling_price,
        NULLIF(pi.sale_price, 0) AS purchase_sale_price
      FROM purchase_items pi
      JOIN purchases pu ON pu.id = pi.purchase_id
      WHERE ${QUALIFYING_PURCHASE}
    ),
    ad_variant_own_line AS (
      SELECT DISTINCT ON (variant_id) variant_id, purchase_selling_price, purchase_sale_price
      FROM ad_purchase_lines
      WHERE variant_id IS NOT NULL
      ORDER BY variant_id, created_at DESC NULLS LAST, pi_id DESC
    ),
    ad_color_any_line AS (
      SELECT DISTINCT ON (product_id, match_color) product_id, match_color, purchase_selling_price, purchase_sale_price
      FROM ad_purchase_lines
      WHERE match_color <> ''
      ORDER BY product_id, match_color, created_at DESC NULLS LAST, pi_id DESC
    ),
    ad_color_only_line AS (
      SELECT DISTINCT ON (product_id, match_color) product_id, match_color, purchase_selling_price, purchase_sale_price
      FROM ad_purchase_lines
      WHERE match_color <> '' AND variant_id IS NULL
      ORDER BY product_id, match_color, created_at DESC NULLS LAST, pi_id DESC
    )`;

export const AD_FEED_PURCHASE_JOINS = `
    LEFT JOIN ad_variant_own_line avo ON avo.variant_id = pv.id
    LEFT JOIN ad_color_any_line aca ON aca.product_id = pv.product_id AND aca.match_color = LOWER(TRIM(pv.color))
    LEFT JOIN ad_color_only_line aco ON aco.product_id = pv.product_id AND aco.match_color = LOWER(TRIM(pv.color))`;

const PRICELESS_SIZE_AND_PRODUCT = `(
        COALESCE(
          CASE WHEN pv.manual_price_override_active THEN NULLIF(pv.manual_selling_price, 0) END,
          NULLIF(pv.purchase_selling_price, 0), NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), NULLIF(pv.regular_price, 0)
        ) IS NULL
        AND COALESCE(
          CASE WHEN p.manual_price_override_active THEN NULLIF(p.manual_selling_price, 0) END,
          NULLIF(p.purchase_selling_price, 0), NULLIF(p.selling_price, 0), NULLIF(p.price, 0), NULLIF(p.regular_price, 0)
        ) IS NULL
      )`;

const winningLine = (field) => `CASE
        WHEN avo.variant_id IS NOT NULL THEN avo.${field}
        WHEN ${PRICELESS_SIZE_AND_PRODUCT} THEN aca.${field}
        ELSE aco.${field}
      END`;

export const AD_FEED_PURCHASE_COLUMNS = `
      COALESCE(${winningLine("purchase_selling_price")}, NULLIF(pv.purchase_selling_price, 0)) AS variant_line_purchase_selling_price,
      COALESCE(${winningLine("purchase_sale_price")}, NULLIF(pv.sale_price, 0)) AS variant_line_sale_price`;
