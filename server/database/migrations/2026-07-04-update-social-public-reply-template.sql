UPDATE social_automation_settings
SET public_reply_template = 'أهلاً وسهلاً يا {{customer_name}} ❤️
تم الرد في الخاص يا صديقي 
وعندنا شحن لجميع محافظات مصر 
━━━━━━━━━━━━━━━━━━
 العنوان:
دمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️

 اللوكيشن:
https://share.google/1e0cM7JVmxyLTpWVe'
WHERE TRIM(public_reply_template) IN (
  'تم إرسال التفاصيل في رسالة خاصة',
  'تم إرسال التفاصيل في رسالة خاصة '
);

ALTER TABLE IF EXISTS social_automation_settings
  ALTER COLUMN public_reply_template SET DEFAULT 'أهلاً وسهلاً يا {{customer_name}} ❤️
تم الرد في الخاص يا صديقي 
وعندنا شحن لجميع محافظات مصر 
━━━━━━━━━━━━━━━━━━
 العنوان:
دمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️

 اللوكيشن:
https://share.google/1e0cM7JVmxyLTpWVe';
