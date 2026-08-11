# M1 ERP table pagination audit

## Scope and rules

- Standard interactive page sizes: 10, 25, 50, 100.
- Every paged operational list uses `Pagination` from `src/shared/ui`.
- Filtering, searching and sorting happen before client-side slicing.
- Server-backed lists send `page`/`limit` or `offset`/`limit`; they do not fetch the full dataset to paginate in React.
- Detail tables, short lookup/configuration lists, dashboards, print/PDF tables and storefront carousels are intentionally not paginated.

## Migrated operational lists

| Area | Screen | Mode | Notes |
| --- | --- | --- | --- |
| Sales | Customers | Server | Existing API page/limit preserved; standard sizes and numeric controls added. |
| Catalog | Products | Server | Existing API page/limit preserved; stored page-size preference now uses standard sizes. |
| Orders | Orders dashboard | Client | Search/filter first, then slice. |
| Purchases | Purchases dashboard | Client | Search/filter first, then slice. |
| Purchases | Suppliers dashboard | Client | Search/sort first, then slice. |
| Reports | Unified reports table | Client | Search/sort first, then slice. |
| Inventory | Inventory history | Server | API receives limit and offset. |
| Inventory | Manager approval sessions | Server | API receives page and limit. |
| Accounting | Journal entries | Server | API receives limit and offset. |
| Employees | Branches | Client | Search first, then slice. |
| Catalog | Manufacturers | Client | Search first, then slice. |
| Catalog | Units | Client | Search first, then slice. |

## Intentional exceptions

- **Record-detail and editor line tables:** product variants/edit matrices, product details, purchase details/order lines, customer loyalty details, journal-entry form/preview lines and employee payroll detail. These rows belong to one record or draft and splitting them across pages would hide required context.
- **Small lookup/configuration tables:** payment-method mappings, cash registers, cost-center setup, website/settings tables and size guides. These are bounded reference lists, not growing transaction feeds.
- **Dashboard snapshots:** analytics, attendance summaries, marketing panels, loyalty summaries and AI analytics. Their tables are already bounded top-N/report widgets.
- **POS and cart tables:** cart contents, receipt/payment breakdowns and currently selected items must remain visible as one transaction.
- **Export/print/PDF HTML tables:** files under `lib/*Export.js`, PDF helpers and print templates are not interactive UI.
- **Public storefront pagination:** `StorefrontProductListingPage` keeps its URL-based SEO pagination and `Link rel=prev/next`; replacing it with the ERP control would change crawlable URLs and storefront styling.
- **Virtualized shipping grid:** `ShippingCenter` uses viewport virtualization and server filters. Adding a second client pager would conflict with its scroll window; it should be migrated only together with explicit server page metadata.
- **Legacy/dead duplicates:** `src/components/Table.jsx`, `src/shared/components/Table.jsx` and duplicate legacy user-table components have no active imports. They were not made a second pagination system.

## Final old-pagination check

The old `Pager`/`PagerButton` implementations were removed from orders, purchases and suppliers. The only separate numeric pager found after migration is the public storefront URL pager, retained for the documented SEO reason above.
