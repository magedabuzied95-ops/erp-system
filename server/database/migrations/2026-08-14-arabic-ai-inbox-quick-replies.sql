BEGIN;

CREATE TEMP TABLE legacy_quick_reply_tenants ON COMMIT DROP AS
SELECT DISTINCT tenant_id
FROM ai_inbox_quick_replies
WHERE name IN ('Greeting', 'Contact Support', 'Thanks & Close');

UPDATE ai_inbox_quick_replies
SET name = CASE name
      WHEN 'Greeting' THEN 'ترحيب'
      WHEN 'Contact Support' THEN 'جاري التأكد'
      WHEN 'Thanks & Close' THEN 'المقاس واللون'
      ELSE name
    END,
    message = CASE name
      WHEN 'Greeting' THEN 'أهلاً وسهلاً 👋 منورنا، تحب تسأل عن موديل أو مقاس معين؟'
      WHEN 'Contact Support' THEN 'تمام، ثانية واحدة بس أتأكدلك من المتاح وأرد عليك.'
      WHEN 'Thanks & Close' THEN 'ممكن تقولي المقاس واللون اللي محتاجهم علشان أشوفلك المتاح؟'
      ELSE message
    END,
    updated_at = NOW()
WHERE tenant_id IN (SELECT tenant_id FROM legacy_quick_reply_tenants)
  AND name IN ('Greeting', 'Contact Support', 'Thanks & Close');

INSERT INTO ai_inbox_quick_replies
  (tenant_id, shortcut, name, message, is_active, sort_order, created_by)
SELECT tenants.tenant_id,
       defaults.shortcut,
       defaults.name,
       defaults.message,
       TRUE,
       defaults.sort_order,
       NULL
FROM legacy_quick_reply_tenants AS tenants
CROSS JOIN (VALUES
  ('4', 'بيانات الطلب', 'تمام، ابعتلي الاسم ورقم الموبايل والمحافظة والعنوان بالتفصيل علشان أسجلك الطلب.', 3),
  ('5', 'تأكيد الطلب', 'تمام، طلبك اتسجل وهنتواصل معاك قبل الشحن للتأكيد 🙏', 4),
  ('6', 'غير متاح', 'للأسف المقاس ده مش متاح حاليًا، بس أقدر أشوفلك أقرب بديل لو تحب.', 5),
  ('7', 'متابعة العميل', 'أنا معاك، لو فيه أي تفصيلة تانية محتاج تعرفها قولي.', 6),
  ('8', 'إنهاء المحادثة', 'تحت أمرك في أي وقت، ولو احتجت أي حاجة ابعتلنا هنا 🙏', 7)
) AS defaults(shortcut, name, message, sort_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_inbox_quick_replies AS existing
  WHERE existing.tenant_id = tenants.tenant_id
    AND (existing.shortcut = defaults.shortcut OR existing.name = defaults.name)
);

COMMIT;
