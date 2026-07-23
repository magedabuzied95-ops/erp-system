-- Idempotently invalidate unpublished story assets that do not have the one
-- canonical immutable snapshot. Published history is deliberately untouched.
UPDATE ai_marketing_content_queue
SET rendered_image_url = '',
    story_image_url = '',
    final_asset_url = '',
    media_urls = '[]'::jsonb,
    image_url = CASE
      WHEN image_url LIKE '%/uploads/stories/%' OR image_url LIKE '%/erp/stories/%' THEN ''
      ELSE image_url
    END,
    design_json = COALESCE(design_json, '{}'::jsonb)
      - 'rendered_image_url' - 'story_image_url' - 'final_asset_url'
      - 'generated_media_urls' - 'generated_asset_urls' - 'story_asset_ids'
      - 'story_asset_snapshot' - 'slides'
      || jsonb_build_object(
        'story_template_key', 'm1_story_current',
        'story_template_version', 'v1'
      ),
    metadata = COALESCE(metadata, '{}'::jsonb)
      - 'rendered_image_url' - 'story_image_url' - 'final_asset_url'
      - 'generated_media_urls' - 'generated_asset_urls' - 'story_asset_ids'
      - 'story_asset_snapshot'
      || jsonb_build_object(
        'requires_story_asset_regeneration', true,
        'legacy_story_asset_invalidated_at', CURRENT_TIMESTAMP,
        'story_template_key', 'm1_story_current',
        'story_template_version', 'v1'
      ),
    status = CASE WHEN status IN ('published', 'archived') THEN status ELSE 'pending_generation' END,
    publish_status = CASE WHEN publish_status = 'published' THEN publish_status ELSE 'draft' END,
    updated_at = CURRENT_TIMESTAMP
WHERE content_type = 'story'
  AND COALESCE(publish_status, status, '') <> 'published'
  AND (
    COALESCE(metadata->'story_asset_snapshot'->>'templateKey', '') <> 'm1_story_current'
    OR COALESCE(metadata->'story_asset_snapshot'->>'templateVersion', '') <> 'v1'
    OR COALESCE(metadata->'story_asset_snapshot'->>'checksum', '') = ''
  );

-- Optional historical template registry: remove obsolete records if this
-- deployment has such a table, without requiring the table in every install.
DO $$
BEGIN
  IF to_regclass('public.ai_marketing_story_templates') IS NOT NULL THEN
    DELETE FROM ai_marketing_story_templates
    WHERE template_key <> 'm1_story_current' OR template_version <> 'v1';
  END IF;
END $$;
