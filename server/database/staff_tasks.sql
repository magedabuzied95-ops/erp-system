ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS department VARCHAR(120);
ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS job_title VARCHAR(120);
ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS position VARCHAR(120);
ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(120),
  entity_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_task_templates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  title_ar TEXT NULL,
  description_ar TEXT NULL,
  notes_ar TEXT NULL,
  task_type VARCHAR(80) NOT NULL DEFAULT 'general',
  department VARCHAR(120) NULL,
  role_key VARCHAR(120) NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  default_deadline_minutes INTEGER NOT NULL DEFAULT 480,
  recurrence VARCHAR(30) NOT NULL DEFAULT 'manual',
  template_kind VARCHAR(20) NOT NULL DEFAULT 'manual',
  is_opening_day_task BOOLEAN NOT NULL DEFAULT FALSE,
  source_module VARCHAR(80) NOT NULL DEFAULT 'operations',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT staff_task_templates_priority_check CHECK (priority IN ('low','medium','high','critical'))
);

CREATE TABLE IF NOT EXISTS staff_task_assignments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id BIGINT NULL REFERENCES staff_task_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  title_ar TEXT NULL,
  description_ar TEXT NULL,
  notes_ar TEXT NULL,
  task_type VARCHAR(80) NOT NULL DEFAULT 'general',
  source_module VARCHAR(80) NOT NULL DEFAULT 'operations',
  source_ref_type VARCHAR(120) NULL,
  source_ref_id VARCHAR(160) NULL,
  source_ref_date DATE NULL,
  department VARCHAR(120) NULL,
  role_key VARCHAR(120) NULL,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  assigned_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  current_assignee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  assigned_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_at TIMESTAMP NULL,
  assignment_source VARCHAR(80) NULL,
  assignment_event_id BIGINT NULL REFERENCES attendance_events(id) ON DELETE SET NULL,
  auto_assign_mode VARCHAR(80) NULL,
  due_at TIMESTAMP NULL,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  completed_by BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  auto_assigned BOOLEAN NOT NULL DEFAULT FALSE,
  reassignment_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT staff_task_assignments_status_check CHECK (status IN ('pending','in_progress','manager_review','completed','cancelled','overdue','reassigned')),
  CONSTRAINT staff_task_assignments_priority_check CHECK (priority IN ('low','medium','high','critical'))
);

CREATE TABLE IF NOT EXISTS staff_task_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  task_id BIGINT NOT NULL REFERENCES staff_task_assignments(id) ON DELETE CASCADE,
  actor_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  from_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  to_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_task_comments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES staff_task_assignments(id) ON DELETE CASCADE,
  actor_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_task_email_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  task_id BIGINT NULL REFERENCES staff_task_assignments(id) ON DELETE SET NULL,
  email_type VARCHAR(80) NOT NULL,
  sent_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dedupe_key TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  error_message TEXT NULL,
  UNIQUE (dedupe_key)
);

CREATE TABLE IF NOT EXISTS staff_task_notification_queue (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  task_id BIGINT NULL REFERENCES staff_task_assignments(id) ON DELETE CASCADE,
  employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  notification_type VARCHAR(80) NOT NULL DEFAULT 'task_assigned',
  channel VARCHAR(30) NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS staff_task_notification_queue ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL;
ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS title_ar TEXT;
ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS notes_ar TEXT;
ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS template_kind VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS is_opening_day_task BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS title_ar TEXT;
ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS notes_ar TEXT;
ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS source_ref_date DATE NULL;
ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS auto_assign_mode VARCHAR(80) NULL;
ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(80) NULL;
ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS assignment_event_id BIGINT NULL REFERENCES attendance_events(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS auto_assign_mode VARCHAR(80) NULL;
ALTER TABLE IF EXISTS staff_task_assignments ALTER COLUMN assigned_at DROP NOT NULL;
UPDATE staff_task_assignments
SET source_ref_date = assigned_date
WHERE source_ref_date IS NULL;

UPDATE staff_task_templates
SET title_ar = CASE title
    WHEN 'Opening display walkthrough' THEN 'مراجعة عرض واجهة المحل'
    WHEN 'Opening readiness checklist' THEN 'قائمة تجهيز افتتاح الفرع'
    WHEN 'Mirror cleaning' THEN 'تنظيف مرايات العملاء'
    WHEN 'Glass cleaning' THEN 'تنظيف الزجاج والكاونتر'
    ELSE title_ar
  END,
  description_ar = CASE description
    WHEN 'Review entrance displays and make sure top-selling items are visible and correctly arranged.' THEN 'راجع واجهة المحل وتأكد إن المنتجات الأكثر مبيعًا ظاهرة ومتنسقة بشكل صحيح.'
    WHEN 'Confirm branch opening readiness, cash area, lights, and customer area before active sales.' THEN 'تأكد من جاهزية الفرع والكاونتر والإضاءة ومنطقة العملاء قبل بدء البيع.'
    WHEN 'Clean customer mirrors and fitting area mirrors, then report any damaged fixtures.' THEN 'نضف مرايات العملاء ومنطقة القياس، وبلغ عن أي تلف في التجهيزات.'
    WHEN 'Clean front glass, display glass, and counters without blocking customer movement.' THEN 'نضف زجاج الواجهة وفاترينات العرض والكاونتر من غير ما تعطل حركة العملاء.'
    ELSE description_ar
  END
WHERE title_ar IS NULL OR title_ar = '' OR description_ar IS NULL OR description_ar = '';

UPDATE staff_task_assignments
SET title_ar = CASE title
    WHEN 'Opening display walkthrough' THEN 'مراجعة عرض واجهة المحل'
    WHEN 'Opening readiness checklist' THEN 'قائمة تجهيز افتتاح الفرع'
    WHEN 'Mirror cleaning' THEN 'تنظيف مرايات العملاء'
    WHEN 'Glass cleaning' THEN 'تنظيف الزجاج والكاونتر'
    ELSE title_ar
  END,
  description_ar = CASE description
    WHEN 'Review entrance displays and make sure top-selling items are visible and correctly arranged.' THEN 'راجع واجهة المحل وتأكد إن المنتجات الأكثر مبيعًا ظاهرة ومتنسقة بشكل صحيح.'
    WHEN 'Confirm branch opening readiness, cash area, lights, and customer area before active sales.' THEN 'تأكد من جاهزية الفرع والكاونتر والإضاءة ومنطقة العملاء قبل بدء البيع.'
    WHEN 'Clean customer mirrors and fitting area mirrors, then report any damaged fixtures.' THEN 'نضف مرايات العملاء ومنطقة القياس، وبلغ عن أي تلف في التجهيزات.'
    WHEN 'Clean front glass, display glass, and counters without blocking customer movement.' THEN 'نضف زجاج الواجهة وفاترينات العرض والكاونتر من غير ما تعطل حركة العملاء.'
    ELSE description_ar
  END
WHERE title_ar IS NULL OR title_ar = '' OR description_ar IS NULL OR description_ar = '';

CREATE INDEX IF NOT EXISTS idx_staff_tasks_tenant_status_due ON staff_task_assignments (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_assignee_status ON staff_task_assignments (current_assignee_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_branch_status ON staff_task_assignments (branch_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_source ON staff_task_assignments (source_ref_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_branch_date_source ON staff_task_assignments (tenant_id, branch_id, assigned_date, source_module, task_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tasks_daily_dedupe
  ON staff_task_assignments (
    COALESCE(tenant_id, 0),
    assigned_date,
    task_type,
    COALESCE(current_assignee_id, 0),
    COALESCE(source_ref_type, ''),
    COALESCE(source_ref_id, '')
  )
  WHERE status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tasks_daily_source_dedupe
  ON staff_task_assignments (
    COALESCE(tenant_id, 0),
    assigned_date,
    task_type,
    COALESCE(source_ref_type, ''),
    COALESCE(source_ref_id, '')
  )
  WHERE status <> 'cancelled' AND source_ref_type IS NOT NULL AND source_ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_task_history_task ON staff_task_history (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_task_comments_task ON staff_task_comments (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_task_queue_status ON staff_task_notification_queue (status, next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_task_queue_dedupe ON staff_task_notification_queue (dedupe_key) WHERE dedupe_key IS NOT NULL;
