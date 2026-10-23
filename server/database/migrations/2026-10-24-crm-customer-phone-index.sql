-- Run outside a transaction: concurrent index keeps production customer writes available.
-- Same identity expression used by CRM and canonicalPhoneKey; no data is changed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_customer_canonical_phone
ON customers (tenant_id, (CASE
    WHEN regexp_replace(regexp_replace(translate(COALESCE(phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'), '^00', '') ~ '^201[0-9]{9}$' THEN substr(regexp_replace(regexp_replace(translate(COALESCE(phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'), '^00', ''), 3)
    WHEN regexp_replace(regexp_replace(translate(COALESCE(phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'), '^00', '') ~ '^01[0-9]{9}$' THEN substr(regexp_replace(regexp_replace(translate(COALESCE(phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'), '^00', ''), 2)
    ELSE regexp_replace(regexp_replace(translate(COALESCE(phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'), '^00', '')
  END));
