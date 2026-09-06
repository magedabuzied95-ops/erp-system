-- Grant the Cashier role: products.create, products.edit, customers.edit
--
-- Why: permit() matches the canonical `module.action` now. The Cashier role was
-- shaped around the old aliasing, where holding products:view quietly satisfied
-- permit("products","create"), so saving a product answers
-- `Access Denied (products:create)`. These three grants are the fix.
--
-- Note: customers.edit also covers the customer wallet adjustment endpoint
-- (POST /customers/:id/wallet/adjust) and the customer employee options list —
-- there is no narrower permission for the name alone.
--
-- Idempotent: re-running changes nothing. Matches the Cashier role by name or
-- slug in every tenant, ignoring underscore/hyphen/case spelling.

BEGIN;

INSERT INTO permissions (module, action, description)
VALUES
  ('products',  'create', 'create products'),
  ('products',  'edit',   'edit products'),
  ('customers', 'edit',   'edit customers')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE (
        LOWER(REPLACE(REPLACE(COALESCE(r.name, ''), '_', ' '), '-', ' ')) IN ('cashier', 'pos cashier')
        OR LOWER(REPLACE(REPLACE(COALESCE(r.slug, ''), '_', ' '), '-', ' ')) IN ('cashier', 'pos cashier')
      )
  AND (p.module, p.action) IN (('products', 'create'), ('products', 'edit'), ('customers', 'edit'))
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify: three rows per Cashier role.
SELECT r.id AS role_id, r.name AS role_name, r.tenant_id, p.module || '.' || p.action AS permission
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE (
        LOWER(REPLACE(REPLACE(COALESCE(r.name, ''), '_', ' '), '-', ' ')) IN ('cashier', 'pos cashier')
        OR LOWER(REPLACE(REPLACE(COALESCE(r.slug, ''), '_', ' '), '-', ' ')) IN ('cashier', 'pos cashier')
      )
  AND (p.module, p.action) IN (('products', 'create'), ('products', 'edit'), ('customers', 'edit'))
ORDER BY r.id, permission;
