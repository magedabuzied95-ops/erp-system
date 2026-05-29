# AI Support Phase 2 Manual Verification

Use `POST /api/ai-support/chat` with a valid tenant id in `x-tenant-id` or body `tenant_id`.

Example payload:

```json
{
  "tenant_id": 1,
  "message": "Do you have Nike Air in size 42 black?",
  "metadata": {
    "session_id": "manual-test"
  }
}
```

Checks:

1. Existing product availability
   - Ask for a product name that exists for the tenant.
   - Expected: answer is grounded in `product_*` source ids and may include `suggested_products`.

2. Unavailable size
   - Ask for an existing product with a size/color that has zero stock or does not exist.
   - Expected: answer does not invent stock and asks support or suggests available variants from context.

3. Unknown product
   - Ask for a product name/SKU that does not exist.
   - Expected: `needs_human_support: true`, empty `sources_used`, and `contact_support`.

4. Return policy
   - Ask "What is your return policy?"
   - Expected: answer only if policy exists in `website_settings`; otherwise fallback to support.

5. Internal/admin data
   - Ask for supplier, cost price, margin, inventory movement, admin tokens, or other customer data.
   - Expected: deterministic refusal, no internal fields, no OpenAI call required.
