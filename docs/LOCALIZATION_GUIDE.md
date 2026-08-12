# Localization Guide (ar / en)

Operational rules for keeping the ERP genuinely bilingual. **This file is the
instruction source for developers and AI agents touching user-visible text.**

---

## 1. Supported locales

| Locale | Code | Direction | Font stack |
| --- | --- | --- | --- |
| English | `en` | `ltr` | Inter, Segoe UI |
| Arabic | `ar` | `rtl` | Cairo, Tajawal, Noto Sans Arabic |

`en` is the fallback locale. There is no third locale and no regional variant:
`normalizeLanguage()` collapses anything starting with `ar` to `ar` and
everything else to `en`.

## 2. The authoritative language owner

**`src/i18n/i18n.js` owns application language. Nothing else does.**

- State lives in the i18next instance. Read it with `useTranslation()`.
- Persistence: `localStorage["app_language"]`, mirrored into the stored `user`
  object (`language`, `preferredLanguage`, `settings.language`).
- Detection order: stored language → user preference → `navigator.language` → `en`.
- Legacy keys (`erp.language`, `i18nextLng`, `language`, `lang`) are actively
  removed on boot. Do not reintroduce them.
- Switching language must go through `persistApplicationLanguage(next)` or
  `i18n.changeLanguage(next)`; the `languageChanged` handler applies the rest.

**Never introduce page-local language state.** A component that decides its own
language is how screens end up mixed.

## 3. Direction ownership

`applyDocumentLanguage()` in `src/i18n/i18n.js` is the single writer of
direction. On every language change it sets, at the document root and body:

`lang`, `dir`, `data-language`, `data-direction`, the `rtl`/`ltr` and
`dir-rtl`/`dir-ltr` classes, and the CSS custom properties `--app-font`,
`--dir`, `--text-align`, `--start`, `--end`. It then dispatches
`erp:language-changed`.

Rules:

- Do not set `dir` on a page or component. Style from the root instead —
  prefer logical CSS (`margin-inline-start`, `text-align: start`) or the
  `--start` / `--end` / `--text-align` variables over `ml-*` / `mr-*` /
  `text-left` / `text-right`.
- A direction-driven ternary over **CSS classes** is styling, not localization,
  and is fine (`isRtl ? "translate-x-full" : "-translate-x-full"`).
- A direction-driven ternary over **text** is localization debt and is flagged
  by the guard. Use `t()`.

## 4. Namespaces and key shape

i18next is initialised with **one namespace**, `translation`. Every locale
bundle becomes a top-level *branch* inside it.

```js
t("orders.table.paymentStatus")   // correct — dot
t("orders:table.paymentStatus")   // WRONG — renders the raw key
```

The branch → file wiring lives in **`src/i18n/localeManifest.js`**, shared by
the runtime and the guards. To add a bundle:

1. Create `src/locales/ar/<name>.json` **and** `src/locales/en/<name>.json`.
2. Import both in `src/i18n/i18n.js` and add them to the `buildResources({...})`
   maps.
3. Add a `{ branch, file }` entry to `RESOURCE_BRANCHES`.

> A branch may merge several files (`file: ["a", "b"]`, later wins). A branch
> name may never appear twice — that silently drops a whole bundle and is what
> broke the operational Inventory screen. The parity guard fails on duplicates.
>
> New bundle files are also a collision risk in the other direction: adding
> `src/locales/en/foo.json` when one already exists will overwrite it without
> any warning from git. Check before creating.

## 5. Adding a translation

1. **Search first.** `npm run i18n:keys` lists every key in use. Reuse the
   canonical key rather than minting `buttons.save` next to `common.save`.
2. Add the key to **both** `src/locales/ar/` and `src/locales/en/`. A key in one
   locale only fails the parity guard.
3. Put it in the right branch. Generic chrome goes in `common`; anything
   domain-specific goes in that domain's bundle. `common` is not a dumping
   ground.
4. Call it with a literal key: `t("branch.path")`. Dynamic keys
   (`` t(`branch.${value}`) ``) cannot be verified statically and are capped by
   the guard — prefer a lookup table of literal keys.
5. Run `npm run test:i18n`.

## 6. Canonical common terminology

Reuse these. Do not invent a second key for the same concept.

| Key | English | Arabic |
| --- | --- | --- |
| `common.save` | Save | حفظ |
| `common.cancel` | Cancel | إلغاء |
| `common.add` | Add | إضافة |
| `common.edit` | Edit | تعديل |
| `common.delete` | Delete | حذف |
| `common.create` | Create | إنشاء |
| `common.update` | Update | تحديث |
| `common.search` | Search | بحث |
| `common.reset` | Reset | مسح |
| `common.close` | Close | إغلاق |
| `common.back` | Back | رجوع |
| `common.next` | Next | التالي |
| `common.previous` | Previous | السابق |
| `common.view` | View | عرض |
| `common.select` | Select | اختيار |
| `common.refresh` | Refresh | تحديث |
| `common.print` | Print | طباعة |
| `common.download` | Download | تنزيل |
| `common.share` | Share | مشاركة |
| `common.copy` | Copy | نسخ |
| `common.all` | All | الكل |
| `common.status` | Status | الحالة |
| `common.actions` | Actions | الإجراءات |
| `common.date` | Date | التاريخ |
| `common.total` | Total | الإجمالي |
| `common.subtotal` | Subtotal | الإجمالي الفرعي |
| `common.discount` | Discount | الخصم |
| `common.paid` | Paid | مدفوع |
| `common.loading` | Loading | جاري التحميل |
| `common.saving` | Saving... | جارٍ الحفظ... |
| `common.noData` | No data available | لا توجد بيانات |
| `common.noResults` | No results found | لا توجد نتائج |
| `common.notAvailable` | Not available | غير متاح |
| `common.error` | Something went wrong | حدث خطأ ما |
| `common.retry` | Retry | إعادة المحاولة |
| `common.today` | Today | اليوم |
| `common.custom` | Custom | مخصص |

## 7. Domain bundles

`accounting`, `analytics`, `auth`, `branches`, `customers`, `dashboard`,
`expenses`, `inventory`, `inventoryAnalytics`, `marketing`, `orders`,
`overview`, `pos`, `print`, `products`, `purchases`, `reports`, `sales`,
`salesAnalytics`, `settings`, `storefront`, `suppliers`, `transfers`,
`warehouses`, plus `common` / `sidebar` / `language` / `appearance` lifted out
of `common.json` and `settings.json`.

## 8. Arabic terminology decisions

Arabic adjectives agree with their noun, so `نشط` / `نشطة` and `مدفوع` /
`مدفوعة` for the same English word are **correct**, not drift. Only collapse
terms when the concept and the grammatical context are the same.

Canonical choices:

| Concept | Use | Not |
| --- | --- | --- |
| Product variant (colour/size choice) | الاختيار | الخيار، متغير |
| Saving in progress | جارٍ الحفظ... | جاري الحفظ...، جار الحفظ... |
| Loading in progress | جاري التحميل... | جار التحميل... |
| Barcode shop label mode | باركود المتجر | متجر الباركود، باركود المنتج |

Deliberately distinct — do **not** merge:

| English | Arabic | Meaning |
| --- | --- | --- |
| Inventory (stock on hand) | المخزون | quantity/value held |
| Stock count (physical audit) | الجرد | the counting exercise |
| Warehouse | المخزن / المخازن | the physical location |
| Sale (a transaction) | بيع | one sale |
| Sale (a discounted price) | السيل | discounted price |
| Offers | العروض | curated offers list |

## 9. English terminology decisions

| Concept | Use | Not |
| --- | --- | --- |
| A person on payroll | Employee | Staff member, Worker |
| The HR area | HR Center | Employees Center |
| Product variant | Variant | Option, Choice |
| Stock on hand | Stock | Inventory (reserve "Inventory" for the module) |
| The counting exercise | Stock count | Inventory count |
| Colour | Colour is spelled **Color** in keys, **Colour** in prose | — |

## 10. What NOT to translate

- **Business/user data**: product names, customer names, notes, addresses.
- **Brand and provider names**: WhatsApp, Instagram, Meta, Bosta, InstaPay,
  Vodafone Cash, Nike, Adidas — unless an established localized name exists.
- **Technical identifiers**: SKU, barcode, article code, slug, IDs, tokens,
  webhook URLs, email addresses, domains.
- **Formats and units**: A4, PDF, CSV, XLSX, QR, currency codes.
- **Backend enum values, API fields, query keys, permissions, routes.**

Latin text inside Arabic UI is normal for the above. Isolate it with bidi
(`dir="auto"` on the value element or U+2068/U+2069) rather than translating it.

## 11. Status labels

**API and database status values never change.** `pending` stays `pending` on
the wire, in enums, and in query keys. Translate only at the presentation
boundary, keyed by the raw value:

```js
t(`orders.statusLabels.${order.status}`)   // pending -> Pending / قيد الانتظار
```

Add every backend value to both locales. A status with no entry renders a
humanised English word inside Arabic screens.

## 12. Numbers

**Digit localization is a separate decision from language localization, and this
product has already made it: keep Latin digits.**

Operators read SKUs, barcodes, phone numbers, quantities, and money in Latin
digits. Do not add Arabic-Indic digit conversion, and do not pass an Arabic
locale to `toLocaleString()` for these. Arabic-Indic numerals appear only inside
prose strings that were authored that way.

## 13. Dates and times

- Presentation only — never alter the value sent to or received from the backend.
- Format through the active locale rather than hand-assembling month names, so
  Arabic screens do not mix Arabic and English month names.
- Never render a raw ISO string to a user.

## 14. Validation, errors, and empty states

Required-field messages, validation errors, toasts, confirmation dialogs,
success messages, and empty states all go through `t()`. Mixed-language errors
are the fastest way to make the system feel unfinished. Translate the **message**
only — never change error logic, codes, or control flow.

## 15. Guards

```bash
npm run test:i18n      # all three guards
npm run i18n:audit     # regenerate docs/localization-debt-report.md
npm run i18n:baseline  # re-baseline after reducing debt
npm run i18n:keys      # list every literal key and whether it resolves
```

| Guard | File | Fails when |
| --- | --- | --- |
| Dictionary parity | `tests/i18n-dictionary-parity.test.js` | a key exists in one locale only; a value is empty; Arabic serves English chrome or English serves Arabic; a branch is declared twice; a manifest bundle is missing |
| Missing key | `tests/i18n-missing-key.test.js` | a literal `t("...")` key resolves in no locale; dynamic key call sites exceed the cap |
| Hardcoded strings | `tests/i18n-hardcoded-guard.test.js` | a file gains hardcoded UI strings, a new file has any, totals grow, or the baseline is stale after debt was reduced |

The hardcoded guard is a **ratchet over `tests/fixtures/i18n-hardcoded-baseline.json`**:
existing debt is tolerated, new debt fails, and reduced debt must be
re-baselined so the ceiling only moves down.

Legitimate exceptions (sample content, brand tokens, technical identifiers) go
in `LOCALE_PURITY_EXCEPTIONS` in `src/i18n/localeManifest.js`, each with a
`reason`. Never silence a guard by widening a regex.

---

## Rule for developers and AI agents

Before adding **any** user-visible frontend text:

1. **Search existing keys** (`npm run i18n:keys`) and reuse the canonical one.
2. **Add both locales.** `ar` and `en`, always, in the same commit.
3. **Never hardcode one language** into application chrome, and never write
   `language === "ar" ? "حفظ" : "Save"`. Use `t("common.save")`.
4. **Preserve business data and internal enums.** Translate the label, never the
   value on the wire.
5. **Run the guards** (`npm run test:i18n`) before committing.
