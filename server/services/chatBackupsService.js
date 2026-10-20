/*
 * Chat backups (inbox top bar → Config → Chat backups).
 *
 * A request inserts a `queued` row and returns at once; the job runs in this process, one at a
 * time (a global chain — a backup is heavy disk + DB work and two at once only slow both).
 * The job reads, never writes, the inbox tables:
 *   ai_support_sessions  → conversations.json (a JSON array, written row by row)
 *   ai_support_messages  → messages.jsonl     (one message per line)
 * both paged with keyset cursors (id > last) so a big tenant never sits in memory. Every
 * "/uploads/..." path a message mentions (visual attachments, voice notes, media URLs in the
 * text/JSON) is looked up in the same upload roots the /uploads static route serves; the ones on
 * disk go into the zip under media/, the rest are counted as missing.
 * The .zip is built with jszip (already a dependency) from lazily-opened file streams, so neither
 * the JSON nor the media is ever fully buffered, and lands in uploads/chat-backups/<48 hex>.zip.
 * Files live 7 days; expired ones are deleted the next time the list is read. A job that was
 * running when the process restarted is marked failed on the next read.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import db from "../database/db.js";

const RETENTION_DAYS = 7;
const SESSION_PAGE = 500;
const MESSAGE_PAGE = 2000;
const TIMEZONE = "Africa/Cairo";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Same three roots server.js serves /uploads from, in the same order.
const UPLOAD_ROOTS = [...new Set([
  path.resolve(process.cwd(), "uploads"),
  path.resolve(serverDir, "uploads"),
  path.resolve(serverDir, "..", "uploads"),
])];
const BACKUP_DIR_NAME = "chat-backups";
const backupRoot = () => path.resolve(process.cwd(), "uploads", BACKUP_DIR_NAME);

const httpError = (message, status = 400, code = "CHAT_BACKUP_INVALID") =>
  Object.assign(new Error(message), { status, code });

const tenantOf = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw httpError("A valid tenant id is required");
  return parsed;
};

const text = (value = "") => String(value ?? "").trim();

let schemaReady = null;
export const ensureChatBackupsSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_backups (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'queued',
        requested_by BIGINT NULL,
        requested_by_name TEXT NOT NULL DEFAULT '',
        filters JSONB NOT NULL DEFAULT '{}'::jsonb,
        conversations INTEGER NOT NULL DEFAULT 0,
        messages INTEGER NOT NULL DEFAULT 0,
        files INTEGER NOT NULL DEFAULT 0,
        missing_files INTEGER NOT NULL DEFAULT 0,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        file_path TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        available_until TIMESTAMPTZ NULL,
        started_at TIMESTAMPTZ NULL,
        finished_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_chat_backups_tenant_created ON chat_backups (tenant_id, created_at DESC)`);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

/* ------------------------------------------------------------------ files */

// Resolves a stored "chat-backups/<name>.zip" to an absolute path, refusing anything outside the dir.
const resolveBackupFile = (relative = "") => {
  const name = path.basename(text(relative));
  if (!/^[a-f0-9]{48}\.zip$/.test(name)) return null;
  return path.join(backupRoot(), name);
};

const removeQuietly = async (file) => {
  if (!file) return;
  await fs.promises.rm(file, { force: true, recursive: true }).catch(() => {});
};

// Opens the file only when the zip writer first reads from it: thousands of media entries must not
// mean thousands of open descriptors. A file that vanished meanwhile ends up as an empty entry.
class LazyFileStream extends Readable {
  constructor(file) {
    super();
    this.file = file;
    this.inner = null;
  }

  _read() {
    if (this.inner) {
      this.inner.resume();
      return;
    }
    this.inner = fs.createReadStream(this.file);
    this.inner.on("data", (chunk) => {
      if (!this.push(chunk)) this.inner.pause();
    });
    this.inner.on("end", () => this.push(null));
    this.inner.on("error", () => this.push(null));
  }

  _destroy(error, callback) {
    this.inner?.destroy();
    callback(error);
  }
}

const UPLOAD_REF_RE = /\/uploads\/([A-Za-z0-9._~%+\-/]+)/g;

const collectUploadRefs = (row, into) => {
  const json = JSON.stringify(row);
  for (const match of json.matchAll(UPLOAD_REF_RE)) {
    let relative = match[1];
    try { relative = decodeURIComponent(relative); } catch { /* keep raw */ }
    relative = path.posix.normalize(relative.replace(/\\/g, "/")).replace(/^\/+/, "");
    if (!relative || relative.startsWith("..") || relative.startsWith(`${BACKUP_DIR_NAME}/`)) continue;
    into.add(relative);
  }
};

const locateUpload = async (relative) => {
  for (const root of UPLOAD_ROOTS) {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) continue;
    try {
      const stat = await fs.promises.stat(absolute);
      if (stat.isFile()) return absolute;
    } catch { /* try next root */ }
  }
  return null;
};

// A file writer that respects backpressure and never leaves an 'error' event unhandled (an
// unhandled stream error would take the whole server down, not just this job).
const openWriter = (file) => {
  const stream = fs.createWriteStream(file);
  let failure = null;
  stream.on("error", (error) => { failure = failure || error; });
  return {
    write: async (chunk) => {
      if (failure) throw failure;
      if (!stream.write(chunk)) {
        await new Promise((resolve) => {
          const done = () => { stream.off("drain", done); stream.off("error", done); resolve(); };
          stream.on("drain", done);
          stream.on("error", done);
        });
      }
      if (failure) throw failure;
    },
    destroy: () => stream.destroy(),
    close: () => new Promise((resolve, reject) => {
      if (failure) { stream.destroy(); reject(failure); return; }
      stream.end(() => (failure ? reject(failure) : resolve()));
    }),
  };
};

const cairoDay = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

/* ------------------------------------------------------------------ job */

const activeJobs = new Set(); // backup ids queued or running in THIS process
let jobChain = Promise.resolve();

const progress = (id, counts) =>
  db.query(
    `UPDATE chat_backups SET conversations = $2, messages = $3 WHERE id = $1`,
    [id, counts.conversations, counts.messages]
  ).catch(() => {});

const runBackup = async (id, tenant, filters) => {
  const token = crypto.randomBytes(24).toString("hex");
  const workDir = path.join(os.tmpdir(), `chat-backup-${token}`);
  const finalPath = path.join(backupRoot(), `${token}.zip`);
  const counts = { conversations: 0, messages: 0, files: 0, missing: 0 };
  const writers = [];
  try {
    await db.query(`UPDATE chat_backups SET status = 'running', started_at = NOW() WHERE id = $1`, [id]);
    await fs.promises.mkdir(workDir, { recursive: true });
    await fs.promises.mkdir(backupRoot(), { recursive: true });

    const boundsResult = await db.query(
      `SELECT (($1::date)::timestamp AT TIME ZONE '${TIMEZONE}') AS range_start,
              ((($2::date) + 1)::timestamp AT TIME ZONE '${TIMEZONE}') AS range_end`,
      [filters.from || null, filters.to || null]
    );
    const rangeStart = boundsResult.rows[0]?.range_start || null;
    const rangeEnd = boundsResult.rows[0]?.range_end || null;
    const channel = text(filters.channel);

    // conversations.json
    const conversationsFile = path.join(workDir, "conversations.json");
    const conversationsOut = openWriter(conversationsFile);
    writers.push(conversationsOut);
    await conversationsOut.write("[\n");
    let cursor = 0;
    for (;;) {
      const page = await db.query(
        `SELECT s.*
         FROM ai_support_sessions s
         WHERE s.tenant_id = $1
           AND s.id > $2
           AND ($3::text = '' OR s.channel = $3::text)
           AND (
             ($4::timestamptz IS NULL AND $5::timestamptz IS NULL)
             OR EXISTS (
               SELECT 1 FROM ai_support_messages m
               WHERE m.tenant_id = s.tenant_id
                 AND m.session_id = s.session_id
                 AND ($4::timestamptz IS NULL OR m.created_at >= $4::timestamptz)
                 AND ($5::timestamptz IS NULL OR m.created_at < $5::timestamptz)
             )
           )
         ORDER BY s.id
         LIMIT ${SESSION_PAGE}`,
        [tenant, cursor, channel, rangeStart, rangeEnd]
      );
      for (const row of page.rows) {
        await conversationsOut.write(`${counts.conversations ? ",\n" : ""}${JSON.stringify(row)}`);
        counts.conversations += 1;
      }
      if (page.rows.length < SESSION_PAGE) break;
      cursor = page.rows[page.rows.length - 1].id;
    }
    await conversationsOut.write("\n]\n");
    await conversationsOut.close();
    await progress(id, counts);

    // messages.jsonl
    const uploadRefs = new Set();
    const messagesFile = path.join(workDir, "messages.jsonl");
    const messagesOut = openWriter(messagesFile);
    writers.push(messagesOut);
    cursor = 0;
    for (;;) {
      const page = await db.query(
        `SELECT m.*
         FROM ai_support_messages m
         WHERE m.tenant_id = $1
           AND m.id > $2
           AND ($3::text = '' OR EXISTS (
             SELECT 1 FROM ai_support_sessions s
             WHERE s.tenant_id = m.tenant_id AND s.session_id = m.session_id AND s.channel = $3::text
           ))
           AND ($4::timestamptz IS NULL OR m.created_at >= $4::timestamptz)
           AND ($5::timestamptz IS NULL OR m.created_at < $5::timestamptz)
         ORDER BY m.id
         LIMIT ${MESSAGE_PAGE}`,
        [tenant, cursor, channel, rangeStart, rangeEnd]
      );
      for (const row of page.rows) {
        collectUploadRefs(row, uploadRefs);
        await messagesOut.write(`${JSON.stringify(row)}\n`);
        counts.messages += 1;
      }
      if (page.rows.length < MESSAGE_PAGE) break;
      cursor = page.rows[page.rows.length - 1].id;
      await progress(id, counts);
    }
    await messagesOut.close();
    await progress(id, counts);

    // The zip.
    const zip = new JSZip();
    zip.file("conversations.json", new LazyFileStream(conversationsFile));
    zip.file("messages.jsonl", new LazyFileStream(messagesFile));
    const missingList = [];
    for (const relative of uploadRefs) {
      const absolute = await locateUpload(relative);
      if (!absolute) {
        counts.missing += 1;
        if (missingList.length < 5000) missingList.push(`/uploads/${relative}`);
        continue;
      }
      // Media is already compressed; deflating it again only costs CPU.
      zip.file(`media/${relative}`, new LazyFileStream(absolute), { compression: "STORE" });
      counts.files += 1;
    }
    zip.file("manifest.json", JSON.stringify({
      generated_at: new Date().toISOString(),
      tenant_id: tenant,
      filters,
      conversations: counts.conversations,
      messages: counts.messages,
      files: counts.files,
      missing_files: counts.missing,
      missing_sample: missingList,
    }, null, 2));
    await pipeline(
      zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } }),
      fs.createWriteStream(finalPath)
    );
    const { size } = await fs.promises.stat(finalPath);

    await db.query(
      `UPDATE chat_backups
       SET status = 'ready', conversations = $2, messages = $3, files = $4, missing_files = $5,
           size_bytes = $6, file_path = $7, finished_at = NOW(),
           available_until = NOW() + ($8::int * INTERVAL '1 day')
       WHERE id = $1`,
      [id, counts.conversations, counts.messages, counts.files, counts.missing, size, `${BACKUP_DIR_NAME}/${token}.zip`, RETENTION_DAYS]
    );
  } catch (error) {
    console.error("[chat-backups] job failed", { id, message: error?.message || String(error) });
    await removeQuietly(finalPath);
    await db.query(
      `UPDATE chat_backups SET status = 'failed', error = $2, finished_at = NOW(), conversations = $3, messages = $4 WHERE id = $1`,
      [id, String(error?.message || error).slice(0, 500), counts.conversations, counts.messages]
    ).catch(() => {});
  } finally {
    for (const writer of writers) writer.destroy();
    await removeQuietly(workDir);
    activeJobs.delete(Number(id));
  }
};

/* ------------------------------------------------------------------ public */

const publicBackup = (row) => ({
  id: Number(row.id),
  status: row.status,
  requested_by: row.requested_by ? Number(row.requested_by) : null,
  requested_by_name: row.requested_by_name || "",
  filters: row.filters || {},
  conversations: Number(row.conversations) || 0,
  messages: Number(row.messages) || 0,
  files: Number(row.files) || 0,
  missing_files: Number(row.missing_files) || 0,
  size_bytes: Number(row.size_bytes) || 0,
  error: row.error || "",
  available_until: row.available_until,
  started_at: row.started_at,
  finished_at: row.finished_at,
  created_at: row.created_at,
  downloadable: row.status === "ready" && Boolean(row.file_path),
});

// Expired files are deleted here; jobs this process no longer runs (restart) are marked failed.
const housekeeping = async (tenant) => {
  const expired = await db.query(
    `WITH old AS (
       SELECT id, file_path FROM chat_backups
       WHERE tenant_id = $1 AND status = 'ready' AND available_until < NOW()
       FOR UPDATE
     )
     UPDATE chat_backups b SET status = 'expired', file_path = ''
     FROM old WHERE b.id = old.id
     RETURNING old.file_path AS old_path`,
    [tenant]
  );
  for (const row of expired.rows) await removeQuietly(resolveBackupFile(row.old_path));
  const orphaned = await db.query(
    `SELECT id FROM chat_backups WHERE tenant_id = $1 AND status IN ('queued', 'running')`,
    [tenant]
  );
  const lost = orphaned.rows.map((row) => Number(row.id)).filter((id) => !activeJobs.has(id));
  if (lost.length) {
    await db.query(
      `UPDATE chat_backups SET status = 'failed', error = 'Interrupted by a server restart', finished_at = NOW()
       WHERE tenant_id = $1 AND id = ANY($2::bigint[]) AND status IN ('queued', 'running')`,
      [tenant, lost]
    );
  }
};

export const listChatBackups = async ({ tenantId, limit = 50 } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureChatBackupsSchema();
  await housekeeping(tenant);
  const result = await db.query(
    `SELECT * FROM chat_backups WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [tenant, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return result.rows.map(publicBackup);
};

export const listBackupChannels = async ({ tenantId } = {}) => {
  const tenant = tenantOf(tenantId);
  try {
    const result = await db.query(
      `SELECT channel, COUNT(*)::int AS conversations FROM ai_support_sessions WHERE tenant_id = $1 GROUP BY channel ORDER BY conversations DESC`,
      [tenant]
    );
    return result.rows.filter((row) => text(row.channel));
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const cleanFilters = (body = {}) => {
  if (body.scope === "all" || !body.scope) {
    const hasAny = text(body.channel) || text(body.from) || text(body.to);
    if (!hasAny) return { scope: "all" };
  }
  const from = text(body.from);
  const to = text(body.to);
  if (from && !DATE_RE.test(from)) throw httpError("from must be YYYY-MM-DD", 400, "CHAT_BACKUP_DATE_INVALID");
  if (to && !DATE_RE.test(to)) throw httpError("to must be YYYY-MM-DD", 400, "CHAT_BACKUP_DATE_INVALID");
  const [start, end] = from && to && from > to ? [to, from] : [from, to];
  return {
    scope: "filtered",
    channel: text(body.channel).slice(0, 64),
    from: start,
    to: end,
  };
};

export const requestChatBackup = async ({ tenantId, body = {}, user = {} } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureChatBackupsSchema();
  await housekeeping(tenant);
  const busy = await db.query(
    `SELECT id FROM chat_backups WHERE tenant_id = $1 AND status IN ('queued', 'running') LIMIT 1`,
    [tenant]
  );
  if (busy.rows[0]) throw httpError("A backup is already being prepared", 409, "CHAT_BACKUP_IN_PROGRESS");
  const filters = cleanFilters(body);
  const requestedBy = Number(user?.id || user?.user_id) || null;
  const requestedByName = text(user?.name || user?.full_name || user?.username || user?.email || "");
  const inserted = await db.query(
    `INSERT INTO chat_backups (tenant_id, status, requested_by, requested_by_name, filters)
     VALUES ($1, 'queued', $2, $3, $4::jsonb)
     RETURNING *`,
    [tenant, requestedBy, requestedByName, JSON.stringify(filters)]
  );
  const row = inserted.rows[0];
  const id = Number(row.id);
  activeJobs.add(id);
  // Not awaited: the request returns the queued row; the list shows the progress.
  jobChain = jobChain.then(() => runBackup(id, tenant, filters)).catch(() => {});
  return publicBackup(row);
};

export const resolveBackupDownload = async ({ tenantId, id } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureChatBackupsSchema();
  await housekeeping(tenant);
  const result = await db.query(
    `SELECT * FROM chat_backups WHERE tenant_id = $1 AND id = $2`,
    [tenant, Number(id) || 0]
  );
  const row = result.rows[0];
  if (!row) throw httpError("Backup not found", 404, "CHAT_BACKUP_NOT_FOUND");
  if (row.status !== "ready") throw httpError("This backup is not available", 409, "CHAT_BACKUP_NOT_READY");
  const absolute = resolveBackupFile(row.file_path);
  if (!absolute) throw httpError("Backup file missing", 410, "CHAT_BACKUP_FILE_MISSING");
  try {
    await fs.promises.access(absolute, fs.constants.R_OK);
  } catch {
    throw httpError("Backup file missing", 410, "CHAT_BACKUP_FILE_MISSING");
  }
  const day = cairoDay(row.created_at);
  return { absolute, filename: `chat-backup-${day}-${row.id}.zip`, size: Number(row.size_bytes) || 0 };
};
