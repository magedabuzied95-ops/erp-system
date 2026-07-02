# AI Data Remediation Plan

Source: `server/reports/ai-data-integrity-report.json`

## Summary

- Products checked: 9
- Variants checked: 119
- Images checked: 40
- Total issues: 437
- Critical: 52
- Medium: 385
- Low: 0
- AI Readiness Score: 0%
- CSV rows exported: 438

## Summary by Severity

| Severity | Count |
| --- | ---: |
| critical | 52 |
| medium | 385 |
| low | 0 |

## Summary by Issue Type

| Issue Type | Count |
| --- | ---: |
| Duplicate slugs (`duplicate_slug`) | 41 |
| Missing Arabic search keywords (`missing_arabic_search_keywords`) | 40 |
| Search discoverability failures (`product_cannot_be_found_by_expected_keywords`) | 40 |
| Low AI recommendation confidence (`ai_recommendation_confidence_issue`) | 40 |
| Missing brand (`missing_brand`) | 32 |
| Missing English search keywords (`missing_english_search_keywords`) | 32 |
| Missing main images (`missing_main_image`) | 32 |
| Missing alias keywords (`missing_alias`) | 31 |
| Missing product type (`missing_product_type`) | 31 |
| Missing category (`missing_category`) | 29 |
| Duplicate article codes (`duplicate_article_code`) | 22 |
| Variant stock gaps (`variant_without_stock`) | 21 |
| Missing variant images (`missing_variant_image`) | 20 |
| Missing price source (`missing_price_source`) | 8 |
| Zero selling price (`zero_selling_price`) | 8 |
| Stock inconsistencies (`inconsistent_total_stock`) | 7 |
| Available with zero stock (`available_with_zero_stock`) | 3 |

## Top 20 Priority Fixes

| Severity | Issue Type | Product ID | Product Name | Variant ID | Current Value | Suggested Value | Recommended Action |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
| critical | Duplicate slugs | 1 | Nike Air Jordan 4 |  | slug=nike-air-jordan-4 | nike-air-jordan-4-p1 | review and assign canonical slug with redirect plan |
| critical | Duplicate slugs | 2 | Adidas Black White Running Sneakers for Men |  | slug=adidas-black-white-running-sneakers | adidas-black-white-running-sneakers-p2 | review and assign canonical slug with redirect plan |
| critical | Duplicate slugs | 4 | Adidas Terrex X Goretex-2 Sneakers |  | slug=adidas-terrex-x-goretex-2 | adidas-terrex-x-goretex-2-p4 | review and assign canonical slug with redirect plan |
| critical | Missing price source | 5 | DC Men's Black Casual Sneakers |  | selling_price=0; sale_price=0; display_price=0 |  | enter selling price manually |
| critical | Duplicate slugs | 7 | Nike Shox Black Sneakers |  | slug=nike-shox-black-sneakers | nike-shox-black-sneakers-p7 | review and assign canonical slug with redirect plan |
| critical | Available with zero stock | 7 | Nike Shox Black Sneakers |  | stock=0; status=active; is_active=true |  | mark unavailable or update stock |
| critical | Missing price source | 7 | Nike Shox Black Sneakers |  | selling_price=0; sale_price=0; display_price=0 |  | enter selling price manually |
| critical | Duplicate slugs | 8 | Nike Dunk Low White Black Sneakers |  | slug=nike-dunk-low-white-black-sneakers | nike-dunk-low-white-black-sneakers-p8 | review and assign canonical slug with redirect plan |
| critical | Missing price source | 8 | Nike Dunk Low White Black Sneakers |  | selling_price=0; sale_price=0; display_price=0 |  | enter selling price manually |
| critical | Duplicate slugs | 9 | ASICS Sneakers |  | slug=asics-blue-white-sneakers | asics-blue-white-sneakers-p9 | review and assign canonical slug with redirect plan |
| critical | Missing price source | 9 | ASICS Sneakers |  | selling_price=0; sale_price=0; display_price=0 |  | enter selling price manually |
| critical | Duplicate slugs | 10 | QA Test Product |  | slug=qa-test-product | qa-test-product-p10 | review and assign canonical slug with redirect plan |
| critical | Duplicate slugs | 25 | Adidas Terrex X Goretex-2 |  | slug=adidas-terrex-x-goretex-2-white-black | adidas-terrex-x-goretex-2-white-black-p25 | review and assign canonical slug with redirect plan |
| critical | Available with zero stock | 25 | Adidas Terrex X Goretex-2 |  | stock=0; status=active; is_active=true |  | mark unavailable or update stock |
| critical | Missing price source | 25 | Adidas Terrex X Goretex-2 |  | selling_price=0; sale_price=0; display_price=0 |  | enter selling price manually |
| critical | Duplicate slugs | 26 | شراب |  | slug=شراب | شراب-p26 | review and assign canonical slug with redirect plan |
| critical | Duplicate slugs | 27 | Nike White and Black Casual Sneakers |  | slug=nike-white-black-sneakers-men | nike-white-black-sneakers-men-p27 | review and assign canonical slug with redirect plan |
| critical | Missing price source | 27 | Nike White and Black Casual Sneakers |  | selling_price=0; sale_price=0; display_price=0 |  | enter selling price manually |
| critical | Duplicate slugs | 28 | Nike White and Black Casual Sneakers Copy |  | slug=nike-white-and-black-casual-sneakers-copy | nike-white-and-black-casual-sneakers-copy-p28 | review and assign canonical slug with redirect plan |
| critical | Missing price source | 28 | Nike White and Black Casual Sneakers Copy |  | selling_price=0; sale_price=0; display_price=0 |  | enter selling price manually |

## Safe Auto-Fix Candidates

_None flagged for auto-apply. This export is review-only._

## Manual Decision Required

438 rows require manual review before any catalog change.

## Notes

- Duplicate slugs should be repaired deterministically in a separate change plan, then paired with redirect handling.
- Prices must be entered manually. Do not invent a value.
- Stock should be reconciled from variant truth where the product is variant-managed.
- Image fallback can only be used if business-approved.
- Broken URL and orphan/invalid variant codes were not present in this report.
