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

-- v2 (2026-10-15): set on the product page -- units with a piece count, and one piece
-- price per customer tier for every colour of the model. Only wholesale_* tables change.
ALTER TABLE wholesale_product_packs ADD COLUMN IF NOT EXISTS sell_series BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wholesale_product_packs ADD COLUMN IF NOT EXISTS series_pieces INTEGER NULL;
ALTER TABLE wholesale_product_packs ADD COLUMN IF NOT EXISTS sell_carton BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wholesale_product_packs ADD COLUMN IF NOT EXISTS carton_pieces INTEGER NULL;
ALTER TABLE wholesale_product_packs ADD COLUMN IF NOT EXISTS sell_dozen BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wholesale_product_packs ADD COLUMN IF NOT EXISTS price_wholesale NUMERIC(12,2) NULL;
ALTER TABLE wholesale_product_packs ADD COLUMN IF NOT EXISTS price_half_wholesale NUMERIC(12,2) NULL;
-- 'wholesale' | 'half_wholesale'
ALTER TABLE wholesale_customer_terms ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'wholesale';
ALTER TABLE wholesale_invoice_lines ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NULL;

-- v3 (phase 2): the customer's private statement link, and payments sent with a screenshot
-- (by the customer from that link, or entered by staff). Pending until approved; approving
-- records a normal customer payment.
CREATE TABLE IF NOT EXISTS wholesale_statement_links (
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE TABLE IF NOT EXISTS wholesale_payment_submissions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(30) NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  source VARCHAR(20) NOT NULL DEFAULT 'customer',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  customer_payment_id BIGINT NULL,
  decided_by BIGINT NULL,
  decided_at TIMESTAMPTZ NULL,
  reject_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_payment_submissions_status ON wholesale_payment_submissions (tenant_id, status, created_at DESC);

-- v4 (phase 3): each customer's own weekly balance reminder (Cairo day / hour).
ALTER TABLE wholesale_customer_terms ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wholesale_customer_terms ADD COLUMN IF NOT EXISTS reminder_weekday SMALLINT NOT NULL DEFAULT 6;
ALTER TABLE wholesale_customer_terms ADD COLUMN IF NOT EXISTS reminder_hour SMALLINT NOT NULL DEFAULT 11;
ALTER TABLE wholesale_customer_terms ADD COLUMN IF NOT EXISTS reminder_min_balance NUMERIC(14,2) NOT NULL DEFAULT 1000;
ALTER TABLE wholesale_customer_terms ADD COLUMN IF NOT EXISTS reminder_skip_paid_days SMALLINT NOT NULL DEFAULT 7;
ALTER TABLE wholesale_customer_terms ADD COLUMN IF NOT EXISTS reminder_last_sent_at TIMESTAMPTZ NULL;
CREATE TABLE IF NOT EXISTS wholesale_reminder_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  balance NUMERIC(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_reminder_log_customer ON wholesale_reminder_log (tenant_id, customer_id, created_at DESC);
-- v5: shop-wide wholesale settings (the WhatsApp line reminders leave from).
CREATE TABLE IF NOT EXISTS wholesale_settings (
  tenant_id BIGINT PRIMARY KEY,
  reminder_instance VARCHAR(160) NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
