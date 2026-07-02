# AI Rejection Matrix

النطاق هنا هو مسار الرفض الحالي داخل `server/routes/aiRegressionHarness.js`، وبالتحديد:

- `isRejectionAlternativeMessage`
- `rejectionMemory`
- `rejectContextMatchesProduct`

المرجع الحالي في الكود:

- `server/routes/aiRegressionHarness.js:45-59`
- `server/routes/aiRegressionHarness.js:653-675`

## الهدف

نريد فصل الرفض إلى مستويات واضحة، بحيث كل مستوى يرفض أقل قدر ممكن:

- Variant rejection يرفض النسخة/اللون/المقاس فقط
- Product rejection يرفض المنتج الحالي فقط
- Model rejection يرفض كل نسخ نفس الموديل فقط
- Brand rejection يرفض كل منتجات البراند
- Category rejection يرفض الفئة فقط

## المصفوفة

| Level | النوع | أمثلة الرسائل | الحقول التي يجب أن تتأثر | ما الذي يجب أن يبقى صالحًا | حالة الكود الحالي |
|---|---|---|---|---|---|
| 1 | Variant Rejection | `اللون ده لا`، `المقاس ده لا`، `الفردة دي لا`، `الصورة دي لا` | `rejectedVariant`, `rejectedVariantIds`, `rejectedVariantNames`, `rejectedVariantColors` | نفس المنتج بباقي الـ variants، وباقي المنتجات | غير مدعوم حاليًا |
| 2 | Product Rejection | `لا مش عايز ده`، `وريني بديل`، `مش ده`، `غيره` | `rejectedProductIds`, `rejectedProductNames` | باقي منتجات نفس البراند ونفس الفئة | مدعوم جزئيًا |
| 3 | Model Rejection | `Terrex لا`، `الموديل ده لا`، `Goretex لا` | `rejectedModelNames`, `rejectedModelAliases` | نفس البراند بموديلات أخرى | مدعوم جزئيًا |
| 4 | Brand Rejection | `Adidas لا`، `مش عايز Adidas` | `rejectedBrand`, `rejectedBrandNames` | باقي البراندات | غير مدعوم حاليًا |
| 5 | Category Rejection | `مش عايز Running`، `مش عايز Boots` | `rejectedCategory`, `rejectedCategoryNames` | باقي الفئات | غير مدعوم حاليًا |

## السلوك المطلوب لكل مستوى

### LEVEL 1 - Variant Rejection

الرفض يجب أن يطبق على النسخة/اللون/المقاس فقط.

مثال:

- Card A: `Adidas Terrex` variant black
- Card B: `Adidas Terrex` variant grey

إذا الرسالة رفضت الـ grey، يجب حذف Card B فقط.

الحقول التي يجب أن تُقرأ:

- `variant_id`
- `selected_variant_id`
- `matched_variant_id`
- `variant.color`
- `selected_variant.color`
- `matched_variant.color`

### LEVEL 2 - Product Rejection

الرفض يجب أن يطبق على المنتج الحالي فقط.

مثال:

- Card A: المنتج الحالي
- Card B: نفس البراند لكن منتج مختلف

إذا الرسالة `لا مش عايز ده`، يجب حذف Card A فقط.

### LEVEL 3 - Model Rejection

الرفض يجب أن يطبق على نفس الموديل فقط، حتى لو اختلف اللون أو الـ variant.

مثال:

- `Terrex` variants
- يجب رفض كل `Terrex`
- يجب إبقاء `Adidas` موديلات أخرى

### LEVEL 4 - Brand Rejection

الرفض يجب أن يطبق على كل منتجات البراند.

مثال:

- `Adidas لا`
- يجب رفض كل المنتجات التي `brand = Adidas`
- يجب إبقاء `Nike` و `Puma` وغيرهم

### LEVEL 5 - Category Rejection

الرفض يجب أن يطبق على الفئة فقط.

مثال:

- `Running` يرفض كل منتجات الفئة Running
- يجب إبقاء Casual / Boots / Sandals إذا لم تُرفض

## ما الذي يفعله الكود الحالي الآن

`rejectContextMatchesProduct` الحالي يقرأ فقط:

- `rejectedProductIds`
- `rejectedModelNames`

ولا يقرأ:

- `rejectedVariant`
- `rejectedVariantIds`
- `rejectedBrand`
- `rejectedCategory`

### النتيجة

- Level 2: موجود جزئيًا
- Level 3: موجود جزئيًا
- Level 1: غير موجود
- Level 4: غير موجود
- Level 5: غير موجود

## أين يحدث التوسيع الزائد أو النقص

### يرفض أقل من اللازم

- لا يوجد أي فهم للـ variant
- لا يوجد أي فهم للـ brand
- لا يوجد أي فهم للـ category

### يرفض أكثر من اللازم

- `rejectedModelNames` يعتمد على `includes(...)` داخل `productText`
- إذا كانت قيمة الرفض عامة جدًا، يمكن أن تسقط منتجات أبعد من المقصود
- مثال: كتابة اسم brand أو كلمة category داخل `rejectedModelNames` تجعل الرفض واسعًا أكثر من المطلوب

## أقل تعديل مطلوب لاحقًا

قبل أي refactor كبير، أقل تعديل آمن سيكون:

1. توسيع Memory schema لحقول صريحة:
   - `rejectedVariantIds`
   - `rejectedVariantNames`
   - `rejectedVariantColors`
   - `rejectedBrandNames`
   - `rejectedCategoryNames`
2. تحديث `rejectContextMatchesProduct` ليطبق:
   - variant match أولًا
   - product id match ثانيًا
   - model match ثالثًا
   - brand match رابعًا
   - category match خامسًا
3. استخدام normalization منفصلة لكل مستوى بدل `includes` العام فقط

