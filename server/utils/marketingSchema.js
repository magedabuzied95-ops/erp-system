import db from "../database/db.js";

let schemaReadyPromise = null;

const defaultTemplates = [
  {
    name: "New Arrival Facebook",
    channel: "facebook",
    title_template: "New arrival: {{product_name}}",
    caption_template:
      "وصل جديد\n{{product_name}}\n\nمتاح الآن بألوان ومقاسات مميزة.\nالسعر يبدأ من: {{price}} ج.م\n\nاطلبه الآن قبل نفاد الكمية ✨",
    hashtags: "#fashion #shoes #new_arrival #shopping",
    is_default: true,
  },
  {
    name: "New Arrival Instagram",
    channel: "instagram",
    title_template: "New arrival: {{product_name}}",
    caption_template:
      "وصل جديد\n{{product_name}}\n\nمتاح الآن بألوان ومقاسات مميزة.\nالسعر يبدأ من: {{price}} ج.م\n\nاطلبه الآن قبل نفاد الكمية ✨",
    hashtags: "#fashion #shoes #new_arrival #shopping #instashop",
    is_default: false,
  },
  {
    name: "Offer Post",
    channel: "all",
    title_template: "Special offer: {{product_name}}",
    caption_template:
      "عرض مميز على {{product_name}}.\nالسعر الحالي: {{price}} ج.م\n\nالكمية محدودة، كمل الطلب قبل انتهاء العرض.",
    hashtags: "#offer #sale #shopnow #discount",
    is_default: false,
  },
  {
    name: "Low Stock Urgency",
    channel: "whatsapp",
    title_template: "Low stock alert: {{product_name}}",
    caption_template:
      "الكمية على وشك النفاد لمنتج {{product_name}}.\nالسعر: {{price}} ج.م\n\nبادر بالحجز الآن.",
    hashtags: "#urgent #limited #stockalert",
    is_default: false,
  },
];

const statements = [
  `
  CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    start_date DATE NULL,
    end_date DATE NULL,
    budget NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_post_templates (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    channel VARCHAR(30) NOT NULL DEFAULT 'facebook',
    title_template TEXT NOT NULL DEFAULT '',
    caption_template TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_post_templates_default
    ON marketing_post_templates (tenant_id)
    WHERE is_default = TRUE;
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_posts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    campaign_id BIGINT NULL REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
    template_id BIGINT NULL REFERENCES marketing_post_templates(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    first_comment TEXT NOT NULL DEFAULT '',
    first_comment_status VARCHAR(30) NULL,
    first_comment_error TEXT NULL,
    first_comment_external_id TEXT NULL,
    first_comment_published_at TIMESTAMPTZ NULL,
    hashtags TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    channel VARCHAR(30) NOT NULL DEFAULT 'facebook',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ NULL,
    published_at TIMESTAMPTZ NULL,
    external_post_id VARCHAR(255) NULL,
    platform_post_id TEXT NULL,
    platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    story_status VARCHAR(30) NOT NULL DEFAULT 'draft',
    story_type VARCHAR(30) NOT NULL DEFAULT 'story',
    story_scheduled_at TIMESTAMPTZ NULL,
    story_published_at TIMESTAMPTZ NULL,
    story_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    story_asset_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    story_error_message TEXT NULL,
    error_message TEXT NULL,
    tracking_code TEXT NULL,
    tracking_link TEXT NULL,
    tracking_source TEXT NULL,
    tracking_kind VARCHAR(30) NOT NULL DEFAULT 'post',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_posts
    ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS first_comment TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS first_comment_status VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS first_comment_error TEXT NULL,
    ADD COLUMN IF NOT EXISTS first_comment_external_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS first_comment_published_at TIMESTAMPTZ NULL;
  `,
  `
  ALTER TABLE IF EXISTS marketing_posts
    ADD COLUMN IF NOT EXISTS platform_post_id TEXT NULL;
  `,
  `
  ALTER TABLE IF EXISTS marketing_posts
    ADD COLUMN IF NOT EXISTS platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb;
  `,
  `
  ALTER TABLE IF EXISTS marketing_posts
    ADD COLUMN IF NOT EXISTS story_status VARCHAR(30) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS story_type VARCHAR(30) NOT NULL DEFAULT 'story',
    ADD COLUMN IF NOT EXISTS story_scheduled_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS story_published_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS story_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS story_asset_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS story_error_message TEXT NULL,
    ADD COLUMN IF NOT EXISTS tracking_code TEXT NULL,
    ADD COLUMN IF NOT EXISTS tracking_link TEXT NULL,
    ADD COLUMN IF NOT EXISTS tracking_source TEXT NULL,
    ADD COLUMN IF NOT EXISTS tracking_kind VARCHAR(30) NOT NULL DEFAULT 'post';
  `,
  `
  UPDATE marketing_posts
  SET platform_post_id = external_post_id
  WHERE platform_post_id IS NULL
    AND external_post_id IS NOT NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_posts_tenant_status
    ON marketing_posts (tenant_id, status, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_posts_tenant_channel
    ON marketing_posts (tenant_id, channel, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_posts_tenant_schedule
    ON marketing_posts (tenant_id, scheduled_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS social_publisher_posts (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    product_id BIGINT NULL,
    caption TEXT NOT NULL DEFAULT '',
    first_comment TEXT NOT NULL DEFAULT '',
    first_comment_status VARCHAR(30) NULL,
    first_comment_error TEXT NULL,
    first_comment_external_id TEXT NULL,
    first_comment_published_at TIMESTAMPTZ NULL,
    media_url TEXT NOT NULL DEFAULT '',
    media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    media_type VARCHAR(20) NOT NULL DEFAULT 'image',
    platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
    publish_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ NULL,
    published_at TIMESTAMPTZ NULL,
    platform_post_id TEXT NULL,
    external_post_id TEXT NULL,
    platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  ALTER TABLE IF EXISTS social_publisher_posts
    ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) NOT NULL DEFAULT 'image',
    ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS first_comment TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS first_comment_status VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS first_comment_error TEXT NULL,
    ADD COLUMN IF NOT EXISTS first_comment_external_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS first_comment_published_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS publish_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS platform_post_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS external_post_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS error_message TEXT NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_social_publisher_posts_tenant_created
    ON social_publisher_posts (tenant_id, created_at DESC, id DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_content_drafts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'Feed Post',
    tone VARCHAR(50) NOT NULL DEFAULT 'Luxury',
    platforms JSONB NOT NULL DEFAULT '["facebook","instagram"]'::jsonb,
    title TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    hook TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '',
    media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ NULL,
    published_at TIMESTAMPTZ NULL,
    rejected_at TIMESTAMPTZ NULL,
    error_message TEXT NULL,
    created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    rejected_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    ai_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_content_drafts
    ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS content_type VARCHAR(50) NOT NULL DEFAULT 'Feed Post',
    ADD COLUMN IF NOT EXISTS tone VARCHAR(50) NOT NULL DEFAULT 'Luxury',
    ADD COLUMN IF NOT EXISTS platforms JSONB NOT NULL DEFAULT '["facebook","instagram"]'::jsonb,
    ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS caption TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS hook TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS hashtags TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
    ADD COLUMN IF NOT EXISTS created_by BIGINT NULL,
    ADD COLUMN IF NOT EXISTS approved_by BIGINT NULL,
    ADD COLUMN IF NOT EXISTS rejected_by BIGINT NULL,
    ADD COLUMN IF NOT EXISTS ai_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_content_drafts_tenant_status
    ON marketing_content_drafts (tenant_id, status, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_content_drafts_tenant_schedule
    ON marketing_content_drafts (tenant_id, scheduled_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_automation_settings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    weekly_generation_day INTEGER NOT NULL DEFAULT 1,
    weekly_generation_time VARCHAR(5) NOT NULL DEFAULT '09:00',
    default_platforms JSONB NOT NULL DEFAULT '["facebook","instagram"]'::jsonb,
    default_intensity VARCHAR(20) NOT NULL DEFAULT 'balanced',
    default_approval_mode VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
    auto_generate_next_week BOOLEAN NOT NULL DEFAULT TRUE,
    auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_publish_requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    auto_publish_platforms JSONB NOT NULL DEFAULT '["facebook","instagram"]'::jsonb,
    auto_publish_window_start TIME NOT NULL DEFAULT '10:00',
    auto_publish_window_end TIME NOT NULL DEFAULT '22:00',
    max_auto_posts_per_day INTEGER NOT NULL DEFAULT 2,
    auto_publish_failed_count INTEGER NOT NULL DEFAULT 0,
    last_auto_publish_at TIMESTAMPTZ NULL,
    last_generated_at TIMESTAMPTZ NULL,
    next_run_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id)
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_automation_settings
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS weekly_generation_day INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS weekly_generation_time VARCHAR(5) NOT NULL DEFAULT '09:00',
    ADD COLUMN IF NOT EXISTS default_platforms JSONB NOT NULL DEFAULT '["facebook","instagram"]'::jsonb,
    ADD COLUMN IF NOT EXISTS default_intensity VARCHAR(20) NOT NULL DEFAULT 'balanced',
    ADD COLUMN IF NOT EXISTS default_approval_mode VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
    ADD COLUMN IF NOT EXISTS auto_generate_next_week BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS auto_publish_requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS auto_publish_platforms JSONB NOT NULL DEFAULT '["facebook","instagram"]'::jsonb,
    ADD COLUMN IF NOT EXISTS auto_publish_window_start TIME NOT NULL DEFAULT '10:00',
    ADD COLUMN IF NOT EXISTS auto_publish_window_end TIME NOT NULL DEFAULT '22:00',
    ADD COLUMN IF NOT EXISTS max_auto_posts_per_day INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS auto_publish_failed_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_auto_publish_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_automation_settings_tenant
    ON marketing_automation_settings (tenant_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_automation_settings_next_run
    ON marketing_automation_settings (enabled, next_run_at);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_automation_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL DEFAULT '',
    draft_id BIGINT NULL REFERENCES marketing_content_drafts(id) ON DELETE SET NULL,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    platform VARCHAR(30) NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_automation_logs
    ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS event_type VARCHAR(80) NOT NULL DEFAULT 'automation_event',
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'info',
    ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS draft_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_automation_logs_tenant_created
    ON marketing_automation_logs (tenant_id, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_automation_logs_tenant_event
    ON marketing_automation_logs (tenant_id, event_type, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_automation_logs_tenant_status
    ON marketing_automation_logs (tenant_id, status, created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS ai_marketing_settings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    planning_mode VARCHAR(20) NOT NULL DEFAULT 'weekly',
    stories_per_day INTEGER NOT NULL DEFAULT 20,
    posts_per_day INTEGER NOT NULL DEFAULT 3,
    auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
    require_approval BOOLEAN NOT NULL DEFAULT TRUE,
    campaign_mode VARCHAR(20) NOT NULL DEFAULT 'balanced',
    active_strategies JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    daily_content_quotas JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id)
  );
  `,
  `
  ALTER TABLE IF EXISTS ai_marketing_settings
    ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
    ADD COLUMN IF NOT EXISTS planning_mode VARCHAR(20) NOT NULL DEFAULT 'weekly',
    ADD COLUMN IF NOT EXISTS stories_per_day INTEGER NOT NULL DEFAULT 20,
    ADD COLUMN IF NOT EXISTS posts_per_day INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS require_approval BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS campaign_mode VARCHAR(20) NOT NULL DEFAULT 'balanced',
    ADD COLUMN IF NOT EXISTS active_strategies JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS daily_content_quotas JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_marketing_settings_tenant
    ON ai_marketing_settings (tenant_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS ai_marketing_content_queue (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_type VARCHAR(20) NOT NULL DEFAULT 'story',
    strategy_type VARCHAR(60) NOT NULL DEFAULT 'random_discovery',
    department_id BIGINT NULL,
    department_name TEXT NOT NULL DEFAULT '',
    segment_type VARCHAR(80) NOT NULL DEFAULT '',
    segment_id BIGINT NULL,
    segment_name TEXT NOT NULL DEFAULT '',
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    primary_image_url TEXT NOT NULL DEFAULT '',
    variant_image_url TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    product_url TEXT NOT NULL DEFAULT '',
    design_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'generated',
    scheduled_at TIMESTAMPTZ NULL,
    published_at TIMESTAMPTZ NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS ai_marketing_content_queue
    ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
    ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) NOT NULL DEFAULT 'story',
    ADD COLUMN IF NOT EXISTS strategy_type VARCHAR(60) NOT NULL DEFAULT 'random_discovery',
    ADD COLUMN IF NOT EXISTS department_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS department_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS segment_type VARCHAR(80) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS segment_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS segment_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS variant_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS caption TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS primary_image_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS variant_image_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS product_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS design_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'generated',
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_tenant_status
    ON ai_marketing_content_queue (tenant_id, status, scheduled_at, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_tenant_product_day
    ON ai_marketing_content_queue (tenant_id, product_id, created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS ai_marketing_generation_runs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    run_type VARCHAR(20) NOT NULL DEFAULT 'daily',
    status VARCHAR(30) NOT NULL DEFAULT 'running',
    requested_stories INTEGER NOT NULL DEFAULT 0,
    requested_posts INTEGER NOT NULL DEFAULT 0,
    generated_stories INTEGER NOT NULL DEFAULT 0,
    generated_posts INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ NULL
  );
  `,
  `
  ALTER TABLE IF EXISTS ai_marketing_generation_runs
    ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
    ADD COLUMN IF NOT EXISTS run_type VARCHAR(20) NOT NULL DEFAULT 'daily',
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'running',
    ADD COLUMN IF NOT EXISTS requested_stories INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS requested_posts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS generated_stories INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS generated_posts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_ai_marketing_runs_tenant_started
    ON ai_marketing_generation_runs (tenant_id, started_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_brand_identity (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    brand_name TEXT NOT NULL DEFAULT '',
    brand_tone TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    dialect TEXT NOT NULL DEFAULT '',
    primary_colors JSONB NOT NULL DEFAULT '[]'::jsonb,
    forbidden_words JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferred_cta TEXT NOT NULL DEFAULT '',
    hashtag_style TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id)
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_brand_identity
    ADD COLUMN IF NOT EXISTS brand_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS brand_tone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS dialect TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS primary_colors JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS forbidden_words JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS preferred_cta TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS hashtag_style TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_brand_identity_tenant
    ON marketing_brand_identity (tenant_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_story_campaigns (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    campaign_type VARCHAR(50) NOT NULL DEFAULT 'new_arrival',
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    tone VARCHAR(50) NOT NULL DEFAULT 'Luxury',
    platform VARCHAR(30) NOT NULL DEFAULT 'instagram',
    visual_style VARCHAR(50) NOT NULL DEFAULT 'Luxury',
    cta_goal VARCHAR(50) NOT NULL DEFAULT 'Website',
    story_count INTEGER NOT NULL DEFAULT 4,
    stories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    generated_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMPTZ NULL,
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_story_campaigns
    ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(50) NOT NULL DEFAULT 'new_arrival',
    ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS tone VARCHAR(50) NOT NULL DEFAULT 'Luxury',
    ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NOT NULL DEFAULT 'instagram',
    ADD COLUMN IF NOT EXISTS visual_style VARCHAR(50) NOT NULL DEFAULT 'Luxury',
    ADD COLUMN IF NOT EXISTS cta_goal VARCHAR(50) NOT NULL DEFAULT 'Website',
    ADD COLUMN IF NOT EXISTS story_count INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS stories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS generated_by BIGINT NULL,
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_story_campaigns_tenant_status
    ON marketing_story_campaigns (tenant_id, status, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_story_campaigns_tenant_product
    ON marketing_story_campaigns (tenant_id, product_id, created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_story_exports (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    story_campaign_id BIGINT NOT NULL REFERENCES marketing_story_campaigns(id) ON DELETE CASCADE,
    template_id VARCHAR(80) NOT NULL DEFAULT '',
    export_type VARCHAR(30) NOT NULL DEFAULT 'png',
    file_count INTEGER NOT NULL DEFAULT 0,
    filenames_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_story_exports
    ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS story_campaign_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS template_id VARCHAR(80) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS export_type VARCHAR(30) NOT NULL DEFAULT 'png',
    ADD COLUMN IF NOT EXISTS file_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS filenames_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS created_by BIGINT NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_story_exports_campaign
    ON marketing_story_exports (tenant_id, story_campaign_id, created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_story_trigger_suggestions (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    trigger_type VARCHAR(60) NOT NULL,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    signal_score INTEGER NOT NULL DEFAULT 0,
    signal_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    suggested_campaign_type VARCHAR(60) NOT NULL DEFAULT 'new_arrival',
    suggested_story_count INTEGER NOT NULL DEFAULT 4,
    suggested_visual_style VARCHAR(60) NOT NULL DEFAULT 'Luxury',
    suggested_cta_goal VARCHAR(60) NOT NULL DEFAULT 'Website',
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    generated_campaign_id BIGINT NULL REFERENCES marketing_story_campaigns(id) ON DELETE SET NULL,
    dismissed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_story_trigger_suggestions
    ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(60) NOT NULL DEFAULT 'new_arrival',
    ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS variant_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    ADD COLUMN IF NOT EXISTS signal_score INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS signal_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS suggested_campaign_type VARCHAR(60) NOT NULL DEFAULT 'new_arrival',
    ADD COLUMN IF NOT EXISTS suggested_story_count INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS suggested_visual_style VARCHAR(60) NOT NULL DEFAULT 'Luxury',
    ADD COLUMN IF NOT EXISTS suggested_cta_goal VARCHAR(60) NOT NULL DEFAULT 'Website',
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS generated_campaign_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_story_triggers_tenant_status
    ON marketing_story_trigger_suggestions (tenant_id, status, signal_score DESC, created_at DESC);
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_story_triggers_active_unique
    ON marketing_story_trigger_suggestions (tenant_id, trigger_type, COALESCE(product_id, 0), COALESCE(variant_id, 0))
    WHERE status IN ('pending', 'generated');
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_post_analytics (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES marketing_posts(id) ON DELETE CASCADE,
    platform VARCHAR(30) NOT NULL,
    platform_post_id TEXT NOT NULL,
    likes INTEGER NULL,
    comments INTEGER NULL,
    shares INTEGER NULL,
    reach INTEGER NULL,
    impressions INTEGER NULL,
    saves INTEGER NULL,
    clicks INTEGER NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (post_id, platform)
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_post_analytics
    ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
    ADD COLUMN IF NOT EXISTS platform_post_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS likes INTEGER NULL,
    ADD COLUMN IF NOT EXISTS comments INTEGER NULL,
    ADD COLUMN IF NOT EXISTS shares INTEGER NULL,
    ADD COLUMN IF NOT EXISTS reach INTEGER NULL,
    ADD COLUMN IF NOT EXISTS impressions INTEGER NULL,
    ADD COLUMN IF NOT EXISTS saves INTEGER NULL,
    ADD COLUMN IF NOT EXISTS clicks INTEGER NULL,
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_post_analytics_platform_synced
    ON marketing_post_analytics (platform, synced_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_post_analytics_post_id
    ON marketing_post_analytics (post_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_attribution_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    session_id TEXT NULL,
    source TEXT NULL,
    platform TEXT NULL,
    post_id BIGINT NULL REFERENCES marketing_posts(id) ON DELETE SET NULL,
    campaign TEXT NULL,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
    tracking_code TEXT NULL,
    tracking_link TEXT NULL,
    attribution_type TEXT NULL,
    referrer TEXT NULL,
    user_agent TEXT NULL,
    ip_address TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_attribution_events
    ADD COLUMN IF NOT EXISTS session_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS source TEXT NULL,
    ADD COLUMN IF NOT EXISTS platform TEXT NULL,
    ADD COLUMN IF NOT EXISTS post_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS campaign TEXT NULL,
    ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS order_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS tracking_code TEXT NULL,
    ADD COLUMN IF NOT EXISTS tracking_link TEXT NULL,
    ADD COLUMN IF NOT EXISTS attribution_type TEXT NULL,
    ADD COLUMN IF NOT EXISTS referrer TEXT NULL,
    ADD COLUMN IF NOT EXISTS user_agent TEXT NULL,
    ADD COLUMN IF NOT EXISTS ip_address TEXT NULL,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_attribution_events_tenant_created
    ON marketing_attribution_events (tenant_id, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_attribution_events_event_type
    ON marketing_attribution_events (event_type, created_at DESC);
  `,
  `
  ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS marketing_source TEXT NULL,
    ADD COLUMN IF NOT EXISTS marketing_platform TEXT NULL,
    ADD COLUMN IF NOT EXISTS marketing_post_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS marketing_campaign TEXT NULL,
    ADD COLUMN IF NOT EXISTS attribution_type TEXT NULL,
    ADD COLUMN IF NOT EXISTS marketing_tracking_code TEXT NULL,
    ADD COLUMN IF NOT EXISTS marketing_session_id TEXT NULL;
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_settings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    provider VARCHAR(50) NOT NULL DEFAULT 'meta',
    page_id TEXT NULL,
    instagram_account_id TEXT NULL,
    access_token_encrypted TEXT NULL,
    long_lived_user_token TEXT NULL,
    page_access_token TEXT NULL,
    token_expires_at TIMESTAMPTZ NULL,
    token_status VARCHAR(30) NOT NULL DEFAULT 'missing',
    token_last_validated_at TIMESTAMPTZ NULL,
    last_auto_refresh_at TIMESTAMPTZ NULL,
    next_refresh_check_at TIMESTAMPTZ NULL,
    token_error_message TEXT NULL,
    is_connected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_settings
    ALTER COLUMN page_id DROP NOT NULL,
    ALTER COLUMN page_id DROP DEFAULT,
    ALTER COLUMN instagram_account_id DROP NOT NULL,
    ALTER COLUMN instagram_account_id DROP DEFAULT,
    ALTER COLUMN access_token_encrypted TYPE TEXT;
  `,
  `
  ALTER TABLE IF EXISTS marketing_settings
    ADD COLUMN IF NOT EXISTS long_lived_user_token TEXT NULL,
    ADD COLUMN IF NOT EXISTS page_access_token TEXT NULL,
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS token_status VARCHAR(30) NOT NULL DEFAULT 'missing',
    ADD COLUMN IF NOT EXISTS token_last_validated_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_auto_refresh_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS next_refresh_check_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS token_error_message TEXT NULL;
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_comment_dm_rules (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
    post_id BIGINT NULL REFERENCES marketing_posts(id) ON DELETE SET NULL,
    platform_post_id TEXT NULL,
    trigger_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    excluded_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    match_mode VARCHAR(30) NOT NULL DEFAULT 'any',
    response_message TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_checked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_comment_dm_rules
    ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
    ADD COLUMN IF NOT EXISTS post_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS platform_post_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS trigger_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS excluded_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS match_mode VARCHAR(30) NOT NULL DEFAULT 'any',
    ADD COLUMN IF NOT EXISTS response_message TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_comment_dm_rules_tenant_active
    ON marketing_comment_dm_rules (tenant_id, is_active, platform);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_comment_dm_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id BIGINT NULL REFERENCES marketing_comment_dm_rules(id) ON DELETE SET NULL,
    post_id BIGINT NULL REFERENCES marketing_posts(id) ON DELETE SET NULL,
    platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
    platform_post_id TEXT NULL,
    platform_comment_id TEXT NOT NULL,
    commenter_id TEXT NULL,
    commenter_name TEXT NULL,
    comment_text TEXT NOT NULL DEFAULT '',
    response_message TEXT NOT NULL DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    error_message TEXT NULL,
    meta_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, platform, platform_comment_id)
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_comment_dm_logs
    ADD COLUMN IF NOT EXISTS rule_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS post_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
    ADD COLUMN IF NOT EXISTS platform_post_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS platform_comment_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS commenter_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS commenter_name TEXT NULL,
    ADD COLUMN IF NOT EXISTS comment_text TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS response_message TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
    ADD COLUMN IF NOT EXISTS meta_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_comment_dm_logs_tenant_created
    ON marketing_comment_dm_logs (tenant_id, created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_auto_reply_rules (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    name VARCHAR(255) NOT NULL,
    keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    match_mode VARCHAR(30) NOT NULL DEFAULT 'any',
    public_reply_template TEXT NOT NULL DEFAULT '',
    private_reply_template TEXT NOT NULL DEFAULT '',
    like_comment BOOLEAN NOT NULL DEFAULT TRUE,
    reply_publicly BOOLEAN NOT NULL DEFAULT TRUE,
    send_private_reply BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_auto_reply_rules
    ADD COLUMN IF NOT EXISTS business_id BIGINT,
    ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT 'Auto reply rule',
    ADD COLUMN IF NOT EXISTS keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS match_mode VARCHAR(30) NOT NULL DEFAULT 'any',
    ADD COLUMN IF NOT EXISTS public_reply_template TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS private_reply_template TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS like_comment BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS reply_publicly BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS send_private_reply BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_auto_reply_rules_business_enabled
    ON marketing_auto_reply_rules (business_id, enabled, platform);
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_auto_reply_rules_business_name_platform
    ON marketing_auto_reply_rules (business_id, platform, name);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_post_product_links (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    platform VARCHAR(30) NOT NULL,
    post_id TEXT NOT NULL,
    media_id TEXT NULL,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_post_product_links_unique
    ON marketing_post_product_links (business_id, platform, post_id, product_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_post_product_links_lookup
    ON marketing_post_product_links (business_id, platform, post_id, media_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_comment_events (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    platform VARCHAR(30) NOT NULL,
    post_id TEXT NOT NULL DEFAULT '',
    comment_id TEXT NOT NULL,
    parent_comment_id TEXT NULL,
    user_platform_id TEXT NULL,
    username TEXT NULL,
    message TEXT NOT NULL DEFAULT '',
    matched_rule_id BIGINT NULL REFERENCES marketing_auto_reply_rules(id) ON DELETE SET NULL,
    matched_keyword TEXT NULL,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    lead_score VARCHAR(20) NOT NULL DEFAULT 'low',
    automation_actions JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NULL,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ NULL,
    UNIQUE (platform, comment_id)
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_comment_events
    ADD COLUMN IF NOT EXISTS matched_keyword TEXT NULL,
    ADD COLUMN IF NOT EXISTS lead_score VARCHAR(20) NOT NULL DEFAULT 'low',
    ADD COLUMN IF NOT EXISTS automation_actions JSONB NOT NULL DEFAULT '{}'::jsonb;
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_comment_events_platform_comment
    ON marketing_comment_events (platform, comment_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_comment_events_business_created
    ON marketing_comment_events (business_id, created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_meta_webhook_requests (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NULL REFERENCES tenants(id) ON DELETE SET NULL,
    object VARCHAR(40) NOT NULL DEFAULT '',
    entries_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_meta_webhook_requests_business_created
    ON marketing_meta_webhook_requests (business_id, created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_meta_webhook_requests_created
    ON marketing_meta_webhook_requests (created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS meta_webhook_raw_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    path TEXT NOT NULL DEFAULT '',
    object TEXT NOT NULL DEFAULT '',
    fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    item_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    verbs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    has_comment_like BOOLEAN NOT NULL DEFAULT FALSE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_meta_webhook_raw_events_received_at
    ON meta_webhook_raw_events (received_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_meta_webhook_raw_events_tenant_received_at
    ON meta_webhook_raw_events (tenant_id, received_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS marketing_conversations (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    platform VARCHAR(30) NOT NULL,
    user_platform_id TEXT NOT NULL,
    username TEXT NULL,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    post_id TEXT NULL,
    comment_id TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'new',
    last_message TEXT NOT NULL DEFAULT '',
    last_customer_message TEXT NOT NULL DEFAULT '',
    matched_keyword TEXT NULL,
    lead_score VARCHAR(20) NOT NULL DEFAULT 'low',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, platform, user_platform_id)
  );
  `,
  `
  ALTER TABLE IF EXISTS marketing_conversations
    ADD COLUMN IF NOT EXISTS last_customer_message TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS matched_keyword TEXT NULL,
    ADD COLUMN IF NOT EXISTS lead_score VARCHAR(20) NOT NULL DEFAULT 'low',
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_marketing_conversations_business_updated
    ON marketing_conversations (business_id, updated_at DESC);
  `,
];

export const ensureMarketingSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query("COMMIT");

        for (const template of defaultTemplates) {
          await client.query(
            `
            INSERT INTO marketing_post_templates (
              tenant_id,
              name,
              channel,
              title_template,
              caption_template,
              hashtags,
              is_default
            )
            VALUES (1, $1, $2, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, name)
            DO UPDATE SET
              channel = EXCLUDED.channel,
              title_template = EXCLUDED.title_template,
              caption_template = EXCLUDED.caption_template,
              hashtags = EXCLUDED.hashtags,
              is_default = EXCLUDED.is_default,
              updated_at = CURRENT_TIMESTAMP
            `,
            [
              template.name,
              template.channel,
              template.title_template,
              template.caption_template,
              template.hashtags,
              template.is_default,
            ]
          );
        }

        await client.query(
          `
          INSERT INTO marketing_auto_reply_rules (
            business_id,
            platform,
            enabled,
            name,
            keywords,
            match_mode,
            public_reply_template,
            private_reply_template,
            like_comment,
            reply_publicly,
            send_private_reply
          )
          VALUES (
            1,
            'facebook',
            TRUE,
            'Price & availability auto reply',
            '["بكام","السعر","سعر","كام","price","available","متاح","مقاس"]'::jsonb,
            'any',
            'تم الرد على حضرتك في الرسائل ❤️',
            'أهلاً بحضرتك ❤️
الموديل {{product_name}} سعره: {{price}} ج.م

المتاح حاليًا:
{{variants}}

تحب أأكد لحضرتك المقاس واللون؟',
            TRUE,
            TRUE,
            TRUE
          )
          ON CONFLICT DO NOTHING
          `
        );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
};

export default ensureMarketingSchema;
