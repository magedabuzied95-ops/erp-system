// TikTok Content Posting: creator info -> validate -> init -> FILE_UPLOAD -> poll.
//
// Two distinct, never-conflated flows:
//   DIRECT_POST  (scope video.publish) — the video goes live on the creator's
//                profile. Caption and privacy come from the ERP, so TikTok
//                requires us to fetch and honour creator_info first.
//   INBOX_UPLOAD (scope video.upload)  — the video lands in the creator's TikTok
//                app as a draft. It is NOT published; caption/privacy are chosen
//                by the user inside TikTok. We deliberately send no post_info.
//
// PULL_FROM_URL is not implemented: it requires domain verification and turns
// our backend into an SSRF-adjacent fetcher. FILE_UPLOAD only.

import fs from "node:fs/promises";
import path from "node:path";

import db from "../database/db.js";
import {
  TikTokApiError,
  fetchTikTokPublishStatus,
  initTikTokDirectPost,
  initTikTokDraftUpload,
  queryTikTokCreatorInfo,
  redactTikTokError,
  uploadTikTokVideoChunk,
} from "./tiktokApiClient.js";
import { getValidTikTokAccessToken } from "./tiktokOAuthService.js";

const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const TIKTOK_POST_MODES = Object.freeze({
  DIRECT_POST: "DIRECT_POST",
  INBOX_UPLOAD: "INBOX_UPLOAD",
});

// TikTok's own privacy vocabulary. Never hardcode a subset into the UI: the set
// a given creator may use is returned by creator_info and varies (a private
// account cannot select PUBLIC_TO_EVERYONE at all).
export const TIKTOK_PRIVACY_LEVELS = Object.freeze([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

const MAX_CAPTION_LENGTH = 2200;
// TikTok accepts a single-chunk upload up to 64MB; above that a chunked transfer
// is required. The ERP's publisher media cap is well under this, so one chunk is
// the normal path and the chunk loop is the safety net.
const CHUNK_SIZE_BYTES = 10 * 1024 * 1024;
const SINGLE_CHUNK_LIMIT_BYTES = 64 * 1024 * 1024;

export class TikTokPublishError extends Error {
  constructor(message, code = "TIKTOK_PUBLISH_FAILED", status = 400) {
    super(message);
    this.name = "TikTokPublishError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let schemaReadyPromise = null;

export const ensureTikTokPublishSchema = async (client = db) => {
  if (!schemaReadyPromise || client !== db) {
    const operation = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tiktok_publish_jobs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          social_publisher_post_id BIGINT NULL,
          idempotency_key TEXT NOT NULL,
          post_mode TEXT NOT NULL DEFAULT 'DIRECT_POST',
          publish_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          media_url TEXT NOT NULL DEFAULT '',
          media_bytes BIGINT NULL,
          privacy_level TEXT NOT NULL DEFAULT '',
          post_options JSONB NOT NULL DEFAULT '{}'::jsonb,
          external_post_id TEXT NOT NULL DEFAULT '',
          fail_reason TEXT NOT NULL DEFAULT '',
          last_status_checked_at TIMESTAMP NULL,
          created_by_user_id BIGINT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, idempotency_key)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tiktok_publish_jobs_publish_id ON tiktok_publish_jobs (publish_id) WHERE publish_id <> ''`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tiktok_publish_jobs_open ON tiktok_publish_jobs (tenant_id, status, created_at DESC)`);
      return true;
    })();
    if (client === db) schemaReadyPromise = operation.catch((error) => { schemaReadyPromise = null; throw error; });
    return operation;
  }
  return schemaReadyPromise;
};

// ---------------------------------------------------------------------------
// Creator info (dynamic posting options — never hardcoded)
// ---------------------------------------------------------------------------

// TikTok requires the publishing UI to render the creator's *current* options
// and to have been refreshed within a short window before posting. Everything
// here comes from the API response; nothing is invented locally.
export const getTikTokPostingOptions = async ({ tenantId, client = db } = {}) => {
  const { accessToken } = await getValidTikTokAccessToken({ tenantId, client });
  const info = await queryTikTokCreatorInfo({ accessToken });
  return {
    creator_username: text(info.creator_username),
    creator_nickname: text(info.creator_nickname),
    creator_avatar_url: text(info.creator_avatar_url),
    // The authoritative list for this creator, in TikTok's own order.
    privacy_level_options: Array.isArray(info.privacy_level_options) ? info.privacy_level_options : [],
    // TikTok returns *disable* flags. Kept in that polarity so a missing field
    // reads as "allowed", matching TikTok's own default, instead of silently
    // disabling an interaction the creator actually permits.
    comment_disabled: Boolean(info.comment_disabled),
    duet_disabled: Boolean(info.duet_disabled),
    stitch_disabled: Boolean(info.stitch_disabled),
    max_video_post_duration_sec: Number(info.max_video_post_duration_sec) || 0,
    fetched_at: new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const validateTikTokPostOptions = ({ options = {}, creatorInfo = {}, postMode = TIKTOK_POST_MODES.DIRECT_POST } = {}) => {
  const problems = [];

  if (postMode === TIKTOK_POST_MODES.INBOX_UPLOAD) {
    // A draft carries no caption or privacy — asserting otherwise in the UI
    // would be a lie about where the content ends up.
    return { valid: true, problems: [] };
  }

  const caption = text(options.caption);
  if (caption.length > MAX_CAPTION_LENGTH) problems.push(`Caption exceeds ${MAX_CAPTION_LENGTH} characters`);

  const privacy = text(options.privacy_level);
  const allowed = Array.isArray(creatorInfo.privacy_level_options) ? creatorInfo.privacy_level_options : [];
  if (!privacy) {
    problems.push("A TikTok privacy level must be selected");
  } else if (allowed.length && !allowed.includes(privacy)) {
    problems.push(`Privacy level ${privacy} is not available for this TikTok account`);
  }

  // Honour the creator's interaction settings: TikTok rejects a post that
  // enables an interaction the account has switched off.
  if (creatorInfo.comment_disabled && options.disable_comment === false) problems.push("This TikTok account has comments disabled");
  if (creatorInfo.duet_disabled && options.disable_duet === false) problems.push("This TikTok account has Duet disabled");
  if (creatorInfo.stitch_disabled && options.disable_stitch === false) problems.push("This TikTok account has Stitch disabled");

  // Branded content cannot be SELF_ONLY, and TikTok requires the commercial
  // disclosure toggle before either branded/promotional flag is meaningful.
  const brandedContent = Boolean(options.brand_content_toggle);
  const yourBrand = Boolean(options.brand_organic_toggle);
  if ((brandedContent || yourBrand) && !options.commercial_content_toggle) {
    problems.push("Commercial content disclosure must be enabled to declare branded or promotional content");
  }
  if (brandedContent && privacy === "SELF_ONLY") {
    problems.push("Branded content cannot be posted with SELF_ONLY privacy");
  }

  return { valid: problems.length === 0, problems };
};

const resolveMediaFile = async (mediaUrl) => {
  const relative = text(mediaUrl).replace(/^\/+/, "");
  if (!relative.startsWith("uploads/")) {
    // Only locally-stored publisher media is accepted. Accepting an arbitrary
    // URL here would be PULL_FROM_URL by the back door, minus the verification.
    throw new TikTokPublishError("TikTok publishing requires an uploaded media file", "TIKTOK_MEDIA_UNSUPPORTED", 400);
  }
  const absolute = path.join(process.cwd(), relative);
  const root = path.join(process.cwd(), "uploads");
  const resolved = path.resolve(absolute);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new TikTokPublishError("Invalid media path", "TIKTOK_MEDIA_PATH_INVALID", 400);
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) throw new TikTokPublishError("TikTok media file was not found", "TIKTOK_MEDIA_MISSING", 400);
  return { path: resolved, size: stat.size };
};

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const uploadMediaFile = async ({ uploadUrl, filePath, size }) => {
  const buffer = await fs.readFile(filePath);
  if (size <= SINGLE_CHUNK_LIMIT_BYTES) {
    await uploadTikTokVideoChunk({ uploadUrl, buffer, start: 0, end: size - 1, total: size });
    return { chunks: 1 };
  }
  let chunks = 0;
  for (let start = 0; start < size; start += CHUNK_SIZE_BYTES) {
    const end = Math.min(start + CHUNK_SIZE_BYTES, size) - 1;
    await uploadTikTokVideoChunk({ uploadUrl, buffer: buffer.subarray(start, end + 1), start, end, total: size });
    chunks += 1;
  }
  return { chunks };
};

export const publishToTikTok = async ({
  tenantId,
  userId = null,
  socialPublisherPostId = null,
  idempotencyKey,
  mediaUrl,
  postMode = TIKTOK_POST_MODES.DIRECT_POST,
  options = {},
  client = db,
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) throw new TikTokPublishError("Tenant is required", "TIKTOK_TENANT_REQUIRED", 400);
  const key = text(idempotencyKey);
  if (!key) throw new TikTokPublishError("An idempotency key is required to publish to TikTok", "TIKTOK_IDEMPOTENCY_REQUIRED", 400);

  await ensureTikTokPublishSchema(client);

  const mode = postMode === TIKTOK_POST_MODES.INBOX_UPLOAD ? TIKTOK_POST_MODES.INBOX_UPLOAD : TIKTOK_POST_MODES.DIRECT_POST;

  // Claim the job first. The UNIQUE (tenant_id, idempotency_key) is what stops a
  // double-click, a retried queue job, or two app instances from creating two
  // TikTok posts — the claim happens before any TikTok call, never after.
  const claim = await client.query(
    `INSERT INTO tiktok_publish_jobs (
       tenant_id, social_publisher_post_id, idempotency_key, post_mode, status,
       media_url, privacy_level, post_options, created_by_user_id
     ) VALUES ($1::bigint, $2::bigint, $3::text, $4::text, 'processing', $5::text, $6::text, $7::jsonb, $8::bigint)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      safeTenantId,
      numberOrNull(socialPublisherPostId),
      key,
      mode,
      text(mediaUrl),
      text(options.privacy_level),
      JSON.stringify(options || {}),
      numberOrNull(userId),
    ]
  );

  if (!claim.rowCount) {
    const existing = await client.query(
      `SELECT * FROM tiktok_publish_jobs WHERE tenant_id = $1::bigint AND idempotency_key = $2::text LIMIT 1`,
      [safeTenantId, key]
    );
    return { duplicate: true, job: existing.rows[0] || null };
  }

  const job = claim.rows[0];

  try {
    const { accessToken } = await getValidTikTokAccessToken({ tenantId: safeTenantId, client });
    const media = await resolveMediaFile(mediaUrl);

    let creatorInfo = {};
    if (mode === TIKTOK_POST_MODES.DIRECT_POST) {
      // Re-fetched server-side rather than trusting what the browser showed:
      // the creator could have changed their privacy settings since the form
      // was rendered, and TikTok would reject (or worse, mis-post) on stale data.
      creatorInfo = await getTikTokPostingOptions({ tenantId: safeTenantId, client });
      const validation = validateTikTokPostOptions({ options, creatorInfo, postMode: mode });
      if (!validation.valid) {
        throw new TikTokPublishError(validation.problems.join("; "), "TIKTOK_POST_OPTIONS_INVALID", 400);
      }
      if (creatorInfo.max_video_post_duration_sec && Number(options.video_duration_sec) > creatorInfo.max_video_post_duration_sec) {
        throw new TikTokPublishError(
          `Video exceeds this account's maximum of ${creatorInfo.max_video_post_duration_sec}s`,
          "TIKTOK_VIDEO_TOO_LONG",
          400
        );
      }
    }

    const sourceInfo = {
      source: "FILE_UPLOAD",
      video_size: media.size,
      chunk_size: media.size <= SINGLE_CHUNK_LIMIT_BYTES ? media.size : CHUNK_SIZE_BYTES,
      total_chunk_count: media.size <= SINGLE_CHUNK_LIMIT_BYTES ? 1 : Math.ceil(media.size / CHUNK_SIZE_BYTES),
    };

    const init = mode === TIKTOK_POST_MODES.DIRECT_POST
      ? await initTikTokDirectPost({
        accessToken,
        sourceInfo,
        postInfo: {
          title: text(options.caption).slice(0, MAX_CAPTION_LENGTH),
          privacy_level: text(options.privacy_level),
          disable_comment: Boolean(options.disable_comment) || Boolean(creatorInfo.comment_disabled),
          disable_duet: Boolean(options.disable_duet) || Boolean(creatorInfo.duet_disabled),
          disable_stitch: Boolean(options.disable_stitch) || Boolean(creatorInfo.stitch_disabled),
          brand_content_toggle: Boolean(options.brand_content_toggle),
          brand_organic_toggle: Boolean(options.brand_organic_toggle),
        },
      })
      : await initTikTokDraftUpload({ accessToken, sourceInfo });

    const publishId = text(init.publish_id);
    const uploadUrl = text(init.upload_url);
    if (!publishId || !uploadUrl) throw new TikTokPublishError("TikTok did not return an upload target", "TIKTOK_INIT_INCOMPLETE", 502);

    await client.query(
      `UPDATE tiktok_publish_jobs SET publish_id = $2::text, media_bytes = $3::bigint, status = 'uploading', updated_at = NOW() WHERE id = $1::bigint`,
      [job.id, publishId, media.size]
    );

    await uploadMediaFile({ uploadUrl, filePath: media.path, size: media.size });

    await client.query(
      `UPDATE tiktok_publish_jobs SET status = 'uploaded', updated_at = NOW() WHERE id = $1::bigint`,
      [job.id]
    );

    return {
      duplicate: false,
      job_id: job.id,
      publish_id: publishId,
      post_mode: mode,
      // A draft is NOT a post. Callers and UI must be able to tell them apart
      // without inspecting post_mode strings.
      published: false,
      draft: mode === TIKTOK_POST_MODES.INBOX_UPLOAD,
      status: "uploaded",
    };
  } catch (error) {
    await client.query(
      `UPDATE tiktok_publish_jobs SET status = 'failed', fail_reason = $2::text, updated_at = NOW() WHERE id = $1::bigint`,
      [job.id, redactTikTokError(error)]
    ).catch(() => {});
    throw error instanceof TikTokPublishError || error instanceof TikTokApiError
      ? error
      : new TikTokPublishError(redactTikTokError(error), "TIKTOK_PUBLISH_FAILED", 502);
  }
};

// ---------------------------------------------------------------------------
// Status tracking
// ---------------------------------------------------------------------------

// TikTok's own status vocabulary from /post/publish/status/fetch/.
const TERMINAL_OK = new Set(["PUBLISH_COMPLETE"]);
const TERMINAL_FAIL = new Set(["FAILED"]);

export const syncTikTokPublishStatus = async ({ tenantId, jobId, client = db } = {}) => {
  await ensureTikTokPublishSchema(client);
  const found = await client.query(
    `SELECT * FROM tiktok_publish_jobs WHERE id = $1::bigint AND tenant_id = $2::bigint LIMIT 1`,
    [jobId, numberOrNull(tenantId)]
  );
  const job = found.rows[0];
  if (!job) throw new TikTokPublishError("TikTok publish job was not found", "TIKTOK_JOB_NOT_FOUND", 404);
  if (!text(job.publish_id)) return { job, status: job.status, remote: null };

  const { accessToken } = await getValidTikTokAccessToken({ tenantId, client });
  const remote = await fetchTikTokPublishStatus({ accessToken, publishId: job.publish_id });
  const remoteStatus = text(remote.status).toUpperCase();

  let nextStatus = job.status;
  if (TERMINAL_OK.has(remoteStatus)) {
    // For an inbox upload, PUBLISH_COMPLETE means the draft reached the app —
    // not that anything is live. Keeping a distinct status stops the UI from
    // ever reporting a draft as published.
    nextStatus = job.post_mode === TIKTOK_POST_MODES.INBOX_UPLOAD ? "draft_ready" : "published";
  } else if (TERMINAL_FAIL.has(remoteStatus)) {
    nextStatus = "failed";
  } else if (remoteStatus) {
    nextStatus = "processing";
  }

  const publiclyAvailablePostId = Array.isArray(remote.publicaly_available_post_id)
    ? text(remote.publicaly_available_post_id[0])
    : text(remote.publicly_available_post_id);

  const updated = await client.query(
    `UPDATE tiktok_publish_jobs
     SET status = $2::text,
         external_post_id = COALESCE(NULLIF($3::text, ''), external_post_id),
         fail_reason = CASE WHEN $2::text = 'failed' THEN $4::text ELSE fail_reason END,
         last_status_checked_at = NOW(), updated_at = NOW()
     WHERE id = $1::bigint
     RETURNING *`,
    [job.id, nextStatus, publiclyAvailablePostId, text(remote.fail_reason).slice(0, 300)]
  );

  return {
    job: updated.rows[0],
    status: nextStatus,
    remote: { status: remoteStatus, fail_reason: text(remote.fail_reason) },
  };
};

export const listTikTokPublishJobs = async ({ tenantId, limit = 20, client = db } = {}) => {
  await ensureTikTokPublishSchema(client);
  const result = await client.query(
    `SELECT id, social_publisher_post_id, post_mode, publish_id, status, external_post_id,
            fail_reason, privacy_level, created_at, updated_at, last_status_checked_at
     FROM tiktok_publish_jobs
     WHERE tenant_id = $1::bigint
     ORDER BY created_at DESC
     LIMIT $2::int`,
    [numberOrNull(tenantId), Math.max(1, Math.min(100, Number(limit) || 20))]
  );
  return result.rows;
};
