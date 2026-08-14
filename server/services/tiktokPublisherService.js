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
  describeTikTokFailure,
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
      // Additive columns. attempt preserves retry history; the fail_* columns keep
      // the TikTok error code, log id and upstream status, which were previously
      // collapsed into a single human message and lost for diagnosis.
      await client.query(`ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1`);
      await client.query(`ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS fail_code TEXT NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS fail_kind TEXT NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS fail_log_id TEXT NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS upstream_status INTEGER NULL`);
      await client.query(`ALTER TABLE IF EXISTS tiktok_publish_jobs ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMP NULL`);
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
  //
  // A previously FAILED attempt is reclaimable: the old `DO NOTHING` made any
  // post that failed once permanently unpublishable, because every retry
  // collapsed onto the dead row and was reported back as a success ("already
  // submitted"). The reclaim is expressed as a conditional DO UPDATE so it stays
  // a single atomic statement: two concurrent retries cannot both win, and an
  // in-flight or terminally successful job still matches nothing and is reported
  // as a duplicate exactly as before.
  const claim = await client.query(
    `INSERT INTO tiktok_publish_jobs (
       tenant_id, social_publisher_post_id, idempotency_key, post_mode, status,
       media_url, privacy_level, post_options, created_by_user_id, attempt
     ) VALUES ($1::bigint, $2::bigint, $3::text, $4::text, 'processing', $5::text, $6::text, $7::jsonb, $8::bigint, 1)
     ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
     SET status = 'processing',
         attempt = tiktok_publish_jobs.attempt + 1,
         post_mode = EXCLUDED.post_mode,
         media_url = EXCLUDED.media_url,
         privacy_level = EXCLUDED.privacy_level,
         post_options = EXCLUDED.post_options,
         created_by_user_id = EXCLUDED.created_by_user_id,
         publish_id = '',
         fail_reason = '',
         fail_code = '',
         fail_kind = '',
         fail_log_id = '',
         upstream_status = NULL,
         updated_at = NOW()
     WHERE tiktok_publish_jobs.status = 'failed'
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
    // Either an attempt is in flight, or a previous one already succeeded.
    // Both must stay protected; neither may start a second TikTok post.
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
    // Keep TikTok's own error code, log id and upstream status. Previously only
    // the human message survived, so a rejection like
    // "Please review our integration guidelines" reached the operator with no
    // way to tell which of a dozen documented codes produced it.
    const failure = describeTikTokFailure(error);
    const operation = mode === TIKTOK_POST_MODES.INBOX_UPLOAD ? "inbox_upload_init" : "direct_post_init";

    console.error("[tiktok-publish] failed", {
      provider: "tiktok",
      operation,
      error_code: failure.error_code || "unknown",
      error_kind: failure.kind,
      upstream_status: failure.upstream_status,
      log_id: failure.log_id || "",
      job_id: job.id,
      attempt: job.attempt,
      message: failure.message,
    });

    await client.query(
      `UPDATE tiktok_publish_jobs
       SET status = 'failed', fail_reason = $2::text, fail_code = $3::text, fail_kind = $4::text,
           fail_log_id = $5::text, upstream_status = $6::int, last_failed_at = NOW(), updated_at = NOW()
       WHERE id = $1::bigint`,
      [job.id, failure.message, failure.error_code, failure.kind, failure.log_id, failure.upstream_status]
    ).catch(() => {});

    if (error instanceof TikTokPublishError) throw error;
    if (error instanceof TikTokApiError) {
      // Re-tag with the classified status so the route answers 422/429/409/503
      // instead of a blanket 502 that the browser reports as "NetworkError".
      error.status = failure.http_status;
      throw error;
    }
    throw new TikTokPublishError(failure.message, "TIKTOK_PUBLISH_FAILED", failure.http_status);
  }
};

// ---------------------------------------------------------------------------
// Status tracking
// ---------------------------------------------------------------------------

// TikTok's own status vocabulary from /post/publish/status/fetch/:
//   PROCESSING_UPLOAD / PROCESSING_DOWNLOAD — transfer still running
//   SEND_TO_USER_INBOX — the video reached the creator's inbox for the draft flow
//   PUBLISH_COMPLETE   — the post is live on the profile
//   FAILED             — the whole operation failed
const TERMINAL_OK = new Set(["PUBLISH_COMPLETE"]);
const TERMINAL_FAIL = new Set(["FAILED"]);

// SEND_TO_USER_INBOX is where an inbox upload ENDS as far as this system is
// concerned: TikTok has the video and has notified the creator. Reaching
// PUBLISH_COMPLETE from there requires the creator to open TikTok and finish the
// post themselves, which may never happen and is not ours to wait for. Treating
// it as non-terminal left every draft stuck on "processing" and the composer
// polling forever.
const INBOX_DELIVERED = "SEND_TO_USER_INBOX";

// Internal statuses that end polling. draft_ready and published are successes;
// failed is terminal too.
export const TIKTOK_TERMINAL_JOB_STATUSES = Object.freeze(["published", "draft_ready", "failed"]);

export const resolveTikTokJobStatus = ({ postMode, remoteStatus, currentStatus = "" } = {}) => {
  const remote = text(remoteStatus).toUpperCase();
  const isInbox = postMode === TIKTOK_POST_MODES.INBOX_UPLOAD;

  if (remote === INBOX_DELIVERED) {
    // Only an inbox upload is finished here. For a Direct Post this status is
    // not an outcome at all, and must never be read as "published".
    return isInbox ? "draft_ready" : "processing";
  }
  if (TERMINAL_OK.has(remote)) {
    // For an inbox upload PUBLISH_COMPLETE still means the draft flow finished,
    // not that we published anything — keep the distinct status.
    return isInbox ? "draft_ready" : "published";
  }
  if (TERMINAL_FAIL.has(remote)) return "failed";
  if (remote) return "processing";
  return text(currentStatus);
};

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

  // Status only. This path never re-uploads: it reads the existing publish_id
  // and asks TikTok what became of it.
  const nextStatus = resolveTikTokJobStatus({
    postMode: job.post_mode,
    remoteStatus,
    currentStatus: job.status,
  });

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
