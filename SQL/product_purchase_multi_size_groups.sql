-- Additive migration for selecting multiple canonical purchase size groups.
-- Existing purchase_size_group values remain untouched and continue to be the
-- fallback when purchase_size_groups is NULL. No product is auto-converted.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_size_groups JSONB NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_purchase_size_groups_chk'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_purchase_size_groups_chk
      CHECK (
        purchase_size_groups IS NULL
        OR (
          jsonb_typeof(purchase_size_groups) = 'array'
          AND jsonb_array_length(purchase_size_groups) > 0
          AND purchase_size_groups <@ '["WOMEN", "MEN", "KIDS_CLOG", "BABY", "BOYS"]'::jsonb
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.products VALIDATE CONSTRAINT products_purchase_size_groups_chk;
