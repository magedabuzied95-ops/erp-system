# Factory Reset Operational Data

هذا السكريبت مخصص لمسح بيانات التشغيل التجريبية فقط بعد النقل إلى VPS، بدون لمس المستخدمين أو الصلاحيات أو الفروع أو الإعدادات أو التكاملات أو أي أسرار أو مفاتيح.

الملف:
- `server/scripts/factoryResetOperationalData.js`

السلوك:
- التشغيل بدون flags = `dry-run` فقط.
- التنفيذ الفعلي يتطلب `NODE_ENV=production` مع:
- `--confirm-factory-reset`
- `--i-understand-this-deletes-data`
- قبل الحذف الفعلي يتم إنشاء backup عبر `pg_dump`. إذا فشل النسخ الاحتياطي يتوقف السكريبت فورًا.
- الحذف يتم داخل transaction واحدة باستخدام `DELETE` بترتيب dependencies واضح، بدون `TRUNCATE ... CASCADE`.
- `RESTART IDENTITY` يتم فقط للجداول التي تم حذفها بالكامل بشكل آمن.
- السكريبت يوقف التنفيذ إذا وجد `FK` blocker غير آمن، ويعرضه بوضوح في `dry-run`.

أوامر التشغيل:

```bash
NODE_ENV=production npm run factory-reset:dry-run
NODE_ENV=production npm run factory-reset:production -- --confirm-factory-reset --i-understand-this-deletes-data
```

تحذير:
- هذا السكريبت لا يعدّل `.env`.
- هذا السكريبت لا يلمس جداول `users`, `roles`, `permissions`, `branches`, `settings`, `integrations`, `company_profiles`, `categories`, `brands` وأي جدول تطابقه فلاتر الحماية مثل `token`, `secret`, `webhook`, `meta`, `ai`.
