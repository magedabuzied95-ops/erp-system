ALTER TABLE products ADD COLUMN IF NOT EXISTS bag_type TEXT;

INSERT INTO product_classification_groups (key, name_ar, name_en, sort_order, is_active, deleted_at)
VALUES ('bag_type', 'نوع الشنطة', 'Bag Type', 5, TRUE, NULL)
ON CONFLICT (key) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  deleted_at = NULL,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_classification_options
  (group_id, value, label_ar, label_en, icon, color, sort_order, is_active, deleted_at)
SELECT bag_group.id, option.value, option.label_ar, option.label_en, 'B', '', option.sort_order, TRUE, NULL
FROM product_classification_groups bag_group
CROSS JOIN (
  VALUES
    ('handbag', 'شنطة يد', 'Handbag', 1),
    ('shoulder-bag', 'شنطة كتف', 'Shoulder Bag', 2),
    ('crossbody-bag', 'كروس', 'Crossbody Bag', 3),
    ('tote-bag', 'توت', 'Tote Bag', 4),
    ('waist-bag', 'شنطة خصر', 'Waist Bag', 5),
    ('school-bag', 'شنطة مدرسية', 'School Bag', 6),
    ('clutch', 'كلاتش', 'Clutch', 7),
    ('bucket-bag', 'باكيت', 'Bucket Bag', 8)
) AS option(value, label_ar, label_en, sort_order)
WHERE bag_group.key = 'bag_type'
ON CONFLICT (group_id, value) DO NOTHING;
