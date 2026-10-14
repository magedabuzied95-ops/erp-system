import db from "../../database/db.js";
import { isWholesaleMode } from "./wholesaleMode.js";

// New tables only -- nothing here alters a retail table. Created lazily by the first
// wholesale request, and never at all unless BUSINESS_MODE=wholesale.
const DDL = `
CREATE TABLE IF NOT EXISTS wholesale_price_lists (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_price_lists_tenant ON wholesale_price_lists (tenant_id, sort_order, id);

-- How a product is sold in bulk. series_sizes: the sizes of one سيرية (one piece each,
-- one colour). cartons: [{ key, label, pieces, colors, sizes? }] where sizes is the
-- per-colour size split when it is not a whole number of series.
CREATE TABLE IF NOT EXISTS wholesale_product_packs (
  tenant_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  series_sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
  sell_piece BOOLEAN NOT NULL DEFAULT TRUE,
  cartons JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, product_id)
);

-- Price of ONE PIECE when bought by that unit, per price list.
CREATE TABLE IF NOT EXISTS wholesale_prices (
  tenant_id BIGINT NOT NULL,
  price_list_id BIGINT NOT NULL REFERENCES wholesale_price_lists(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL,
  unit VARCHAR(20) NOT NULL CHECK (unit IN ('piece', 'series', 'carton')),
  piece_price NUMERIC(12,2) NOT NULL CHECK (piece_price >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (price_list_id, product_id, unit)
);
CREATE INDEX IF NOT EXISTS idx_wholesale_prices_product ON wholesale_prices (tenant_id, product_id);

CREATE TABLE IF NOT EXISTS wholesale_customer_terms (
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  price_list_id BIGINT NULL REFERENCES wholesale_price_lists(id) ON DELETE SET NULL,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_days INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, customer_id)
);

-- What the invoice sold in wholesale terms (3 cartons, 2 series ...); the order's own
-- order_items hold the same goods as pieces per colour/size.
CREATE TABLE IF NOT EXISTS wholesale_invoice_lines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  unit VARCHAR(20) NOT NULL,
  unit_label TEXT NOT NULL DEFAULT '',
  unit_qty INTEGER NOT NULL,
  colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  pieces INTEGER NOT NULL,
  piece_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL,
  composition JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_list_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_invoice_lines_order ON wholesale_invoice_lines (tenant_id, order_id, id);
`;

let ready = null;

export const ensureWholesaleSchema = async (client = db) => {
  if (!isWholesaleMode()) throw Object.assign(new Error("Wholesale mode is off"), { status: 404 });
  if (!ready) {
    ready = client.query(DDL).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
};

export const resetWholesaleSchemaMemo = () => {
  ready = null;
};
