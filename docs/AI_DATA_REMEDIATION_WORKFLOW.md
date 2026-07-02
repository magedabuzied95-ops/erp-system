# AI Data Remediation Workflow

This workflow is read-only. It helps the business review catalog issues detected by the AI Data Integrity Suite before any manual fix is applied in the ERP admin UI.

## Files

- `server/reports/ai-data-remediation-export.csv`
- `server/reports/ai-data-remediation-duplicate-slugs.csv`
- `server/reports/ai-data-remediation-prices.csv`
- `server/reports/ai-data-remediation-stock.csv`

## How To Open The CSV Files

- Open them in Excel, Google Sheets, or LibreOffice Calc.
- Keep the first row as the header row.
- Filter by `severity`, `issue_type`, or `product_id` when reviewing a specific product family.

## Column Guide

- `severity`: Risk level from the integrity suite.
- `issue_type`: Human-readable issue category.
- `product_id`: Product record to review.
- `product_name`: Current product name in the catalog.
- `variant_id`: Variant record if the issue is variant-specific.
- `color`: Variant color, when available.
- `size`: Variant size, when available.
- `current_value`: The value currently seen by the integrity suite.
- `suggested_value`: Suggested review-only value. This is not applied automatically.
- `safe_auto_fix_candidate`: `true` only when a change is safe to automate. For this workflow it should stay `false`.
- `requires_manual_decision`: `true` means a human must decide before any change.
- `recommended_action`: The action the admin should take.
- `notes`: Extra context, including business or safety risks.

## Priority Files

### 1. Duplicate Slugs

File: `server/reports/ai-data-remediation-duplicate-slugs.csv`

What to do:

- Open each row and compare the duplicate slug with the product name.
- Keep one canonical slug for the main product.
- For duplicates, use a deterministic proposal such as `original-slug-p<product_id>`.
- Do not publish the new slug until redirects are planned.
- After approval, update redirects so existing public URLs do not break.

What not to do:

- Do not change slugs blindly.
- Do not delete product records to resolve slug conflicts.
- Do not reuse a slug that already exists on another product.

### 2. Missing Prices / Zero Prices

File: `server/reports/ai-data-remediation-prices.csv`

What to do:

- Review the product in the ERP admin UI.
- Enter the selling price manually.
- Use the admin export/import workflow if you need bulk edits.
- If a product has multiple variants, confirm whether the price is product-level or variant-level before saving.

What not to do:

- Do not guess a price from similar products.
- Do not use the AI to invent a price.
- Do not copy a price from another product unless business confirms it.

### 3. Stock Inconsistencies

File: `server/reports/ai-data-remediation-stock.csv`

What to do:

- Compare product stock with the sum of active variant stock.
- If the product is variant-managed, derive availability from variant stock.
- Reconcile the product record so the AI-facing stock truth matches the variant truth.
- If stock is zero, mark the product unavailable until the business confirms the inventory state.

What not to do:

- Do not inflate stock to make the product look sellable.
- Do not suppress zero-stock variants without checking the business workflow.
- Do not write stock changes automatically from this export.

## What Should Not Be Auto-Fixed

- Duplicate slugs
- Missing prices
- Zero prices
- Available-with-zero-stock rows
- Stock inconsistencies
- Article code issues
- Image coverage issues

These items affect public URLs, sellability, or inventory truth and need business approval.

## Suggested Manual Fix Process In ERP Admin

1. Open the CSV file for the issue group.
2. Filter by `product_id` and review all rows for the same product.
3. Open the product in the ERP admin UI.
4. Compare the current data with the CSV notes.
5. Apply the fix manually in the admin UI or approved import workflow.
6. Re-run the integrity checks after saving changes.

## When To Re-run The Checks

Run these commands after manual edits:

```bash
node server/scripts/testAiDataIntegritySuite.js
node server/scripts/testAiDataRemediationExport.js
node server/scripts/testAiDataRemediationWorkflow.js
```

## CSV Generation Workflow

Run this command to regenerate the split review files:

```bash
node server/scripts/testAiDataRemediationWorkflow.js
```

It will rewrite:

- `server/reports/ai-data-remediation-duplicate-slugs.csv`
- `server/reports/ai-data-remediation-prices.csv`
- `server/reports/ai-data-remediation-stock.csv`

## Notes

- This workflow is review-only.
- It does not modify database rows.
- It does not delete data.
- It does not auto-fix catalog records.
