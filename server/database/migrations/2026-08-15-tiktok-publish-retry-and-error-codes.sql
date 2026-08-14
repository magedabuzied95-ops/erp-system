-- TikTok publish jobs: retry support + preserved provider error detail.
-- Additive only. No existing column, index, or row is removed or rewritten.
-- Applied idempotently at boot by ensureTikTokPublishSchema().

-- Retry history. A job that failed can be reclaimed for a new attempt; this
-- records how many attempts a publish has taken.
ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;

-- Provider error detail. Previously only a human-readable fail_reason survived,
-- so a rejection like "Please review our integration guidelines" could not be
-- mapped back to which documented TikTok error code produced it.
ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS fail_code TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS fail_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS fail_log_id TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS upstream_status INTEGER NULL;
ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMP NULL;
