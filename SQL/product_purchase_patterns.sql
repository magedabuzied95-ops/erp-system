-- Purchase patterns are opt-in. Existing products remain legacy because all
-- new columns are nullable and no data backfill is performed.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS purchase_mode VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS purchase_size_group VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS purchase_size_groups JSONB NULL,
  ADD COLUMN IF NOT EXISTS purchase_colors_per_carton INTEGER NULL,
  ADD COLUMN IF NOT EXISTS purchase_pieces_per_size INTEGER NULL,
  ADD COLUMN IF NOT EXISTS purchase_carton_colors JSONB NULL;

-- NOT VALID keeps the initial constraint-add lock short. Validation then scans
-- existing rows without rewriting the table. Constraint identity is scoped to
-- public.products so the migration remains deterministic across schemas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_purchase_mode_chk'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_purchase_mode_chk
      CHECK (purchase_mode IS NULL OR purchase_mode IN ('INDIVIDUAL', 'FULL_COLOR_RUN', 'FULL_CARTON')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_purchase_size_group_chk'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_purchase_size_group_chk
      CHECK (purchase_size_group IS NULL OR purchase_size_group IN ('WOMEN', 'MEN', 'KIDS_CLOG', 'BABY', 'BOYS')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_purchase_size_groups_chk'
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_purchase_positive_counts_chk'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_purchase_positive_counts_chk
      CHECK (
        (purchase_colors_per_carton IS NULL OR purchase_colors_per_carton > 0)
        AND (purchase_pieces_per_size IS NULL OR purchase_pieces_per_size > 0)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_purchase_pattern_shape_chk'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_purchase_pattern_shape_chk
      CHECK (
        purchase_mode IS NULL
        OR purchase_mode = 'INDIVIDUAL'
        OR (
          purchase_mode = 'FULL_COLOR_RUN'
          AND CASE WHEN jsonb_typeof(purchase_size_groups) = 'array' THEN jsonb_array_length(purchase_size_groups) ELSE CASE WHEN purchase_size_group IS NULL THEN 0 ELSE 1 END END > 0
          AND purchase_pieces_per_size IS NOT NULL
        )
        OR (
          purchase_mode = 'FULL_CARTON'
          AND CASE WHEN jsonb_typeof(purchase_size_groups) = 'array' THEN jsonb_array_length(purchase_size_groups) ELSE CASE WHEN purchase_size_group IS NULL THEN 0 ELSE 1 END END > 0
          AND purchase_pieces_per_size IS NOT NULL
          AND purchase_colors_per_carton IS NOT NULL
          AND purchase_carton_colors IS NOT NULL
          AND jsonb_typeof(purchase_carton_colors) = 'array'
          AND jsonb_array_length(purchase_carton_colors) = purchase_colors_per_carton
          AND jsonb_array_length(purchase_carton_colors) > 0
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.products VALIDATE CONSTRAINT products_purchase_mode_chk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_purchase_size_group_chk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_purchase_size_groups_chk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_purchase_positive_counts_chk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_purchase_pattern_shape_chk;
